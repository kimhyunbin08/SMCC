#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-kimhyunbin08/SMCC}"
RESOURCE_GROUP="${RESOURCE_GROUP:-smcc-rg}"
LOCATION="${LOCATION:-koreacentral}"
APP_NAME="${APP_NAME:-smcc-web}"
ENVIRONMENT="${ENVIRONMENT:-smcc-env}"
SUBJECT_PREFIX=$(gh api "repos/$REPO/actions/oidc/customization/sub" \
  --jq 'if .use_default then .sub_claim_prefix else error("Custom OIDC subjects require an explicit credential setup") end')
if [ -z "$SUBJECT_PREFIX" ] || [ "$SUBJECT_PREFIX" = "null" ]; then
  SUBJECT_PREFIX="repo:$REPO"
fi
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUFFIX=$(printf '%s' "$SUBSCRIPTION_ID" | tr -d '-' | cut -c1-10)
ACR_NAME="${ACR_NAME:-smcc${SUFFIX}}"

az extension add --name containerapp --upgrade --only-show-errors
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --tags project=SMCC --output none
az acr create --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" \
  --sku Basic --admin-enabled false --output none
LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
GROUP_ID=$(az group show --name "$RESOURCE_GROUP" --query id -o tsv)

az identity create --name smcc-deploy --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
DEPLOY_PRINCIPAL=$(az identity show --name smcc-deploy --resource-group "$RESOURCE_GROUP" --query principalId -o tsv)
DEPLOY_CLIENT=$(az identity show --name smcc-deploy --resource-group "$RESOURCE_GROUP" --query clientId -o tsv)
az identity federated-credential create --name github-main --identity-name smcc-deploy \
  --resource-group "$RESOURCE_GROUP" --issuer https://token.actions.githubusercontent.com \
  --subject "${SUBJECT_PREFIX}:ref:refs/heads/main" --audiences api://AzureADTokenExchange --output none
az role assignment create --assignee-object-id "$DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "$GROUP_ID" --output none
az role assignment create --assignee-object-id "$DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope "$ACR_ID" --output none

az identity create --name smcc-pull --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
PULL_ID=$(az identity show --name smcc-pull --resource-group "$RESOURCE_GROUP" --query id -o tsv)
PULL_PRINCIPAL=$(az identity show --name smcc-pull --resource-group "$RESOURCE_GROUP" --query principalId -o tsv)
az role assignment create --assignee-object-id "$PULL_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope "$ACR_ID" --output none

az containerapp env create --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" --logs-destination none --output none
APP_COUNT=$(az containerapp list --resource-group "$RESOURCE_GROUP" --query "[?name=='$APP_NAME'] | length(@)" -o tsv)
if [ "$APP_COUNT" = "0" ]; then
  # Bootstrap only; GitHub Actions replaces this with the SMCC image on the first push.
  az containerapp create --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" --image mcr.microsoft.com/k8se/quickstart:latest \
    --ingress external --target-port 80 --transport http \
    --cpu 0.25 --memory 0.5Gi --min-replicas 0 --max-replicas 1 \
    --user-assigned "$PULL_ID" --output none
fi
az containerapp registry set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --server "$LOGIN_SERVER" --identity "$PULL_ID" --output none
az containerapp ingress update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --target-port 3000 --allow-insecure false --output none
az containerapp revision set-mode --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --mode single --output none

gh variable set AZURE_CLIENT_ID --repo "$REPO" --body "$DEPLOY_CLIENT"
gh variable set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT_ID"
gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"
gh variable set AZURE_RESOURCE_GROUP --repo "$REPO" --body "$RESOURCE_GROUP"
gh variable set AZURE_CONTAINER_APP --repo "$REPO" --body "$APP_NAME"
gh variable set AZURE_ACR_NAME --repo "$REPO" --body "$ACR_NAME"
printf 'Azure resources configured. Push main to deploy the SMCC image.\n'
