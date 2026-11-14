# 서울모닝커피클럽 · SMCC

모닝 커피챗 서비스의 **배포 가능한 앱 뼈대**. 소개 화면만 있으며 모임 생성·참가 신청·프로필·로그인·DB·AI는 아직 구현하지 않았다. 기존 기획은 [ideation.md](ideation.md), 요구사항은 [PRD.md](PRD.md), 구조는 [TRD.md](TRD.md), 작업 기준은 [AGENTS.md](AGENTS.md)에 있다.

기존 [smcc.global](https://smcc.global/)과 별개의 보조 프로토타입이다. 기존 사이트를 변경하거나 도메인을 연결하지 않는다.

## 배포 상태

초기 실제 배포: [SMCC 프로토타입 열기](https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io/).
[성공한 main 자동 배포](https://github.com/kimhyunbin08/SMCC/actions/runs/43535519925)에서 이미지 빌드·OIDC 로그인·리비전 교체·라이브 SHA 확인을 완료했다. Azure CLI의 기존 조직 이메일 계정과 tenant를 확인했으며 배포는 요청한 **innodge 조직 컨텍스트**의 `smcc-rg`에 있다. 개인 이메일 주소나 인증 정보는 문서에 기록하지 않는다.

GitHub 저장소는 [kimhyunbin08/SMCC](https://github.com/kimhyunbin08/SMCC)를 유지한다. 기존 smcc.global 도메인이나 다른 프로젝트 리소스는 변경하지 않았다. 새로운 조직 로그인이나 리소스 이동은 필요하지 않으며, main push 자동 배포를 그대로 사용할 수 있다.

## 로컬 실행

Node.js 24 이상:

```bash
npm start
# 개발: npm run dev
# 검증: npm test
```

또는 Docker Desktop/Engine을 켠 뒤:

```bash
docker compose up --build -d --wait
curl --fail http://localhost:3000/healthz
# 종료
docker compose down
```

브라우저에서 http://localhost:3000 을 연다. 코드 변경 후 Compose는 다시 `up --build`해야 한다.
3000 포트가 사용 중이면 `HOST_PORT=3187 docker compose up --build -d --wait`로 실행하고 http://localhost:3187 을 연다.

## Azure 배포와 이후 수정

**Compose는 로컬용이고 Azure는 Container Apps**다. App Service Compose는 2027-03-31 종료 예정이라 신규 구성에 사용하지 않았다. 같은 Dockerfile로 빌드하므로 앱 코드는 공통이다. Azure Portal에서 리소스를 관리하며 이후에는 **main push → GitHub Actions → 이미지 교체**로 수정된다.

최초 설정은 Azure CLI와 GitHub CLI 로그인 및 리소스 생성/role assignment 권한이 필요하다. 아래는 유료 Azure 리소스를 만든다. 이미 설정된 프로젝트에서는 반복 실행할 필요가 없다.

```bash
az login
az account set --subscription '<사용할 구독 ID>'
gh auth login
bash scripts/setup-azure.sh
```

기본 리소스 그룹 `smcc-rg`, 지역 `koreacentral`, 환경 `smcc-env`, 앱 `smcc-web`, ACR `smcc<구독 ID 앞 10자리>`다. 필요한 경우 실행 시 `LOCATION`, `RESOURCE_GROUP`, `ACR_NAME` 환경 변수로 바꾼다. 허용되지 않은 지역/구독 정책 오류라면 허용 지역을 확인한 뒤 같은 명령에 `LOCATION=<허용 지역>`을 준다. 실패 시 스크립트는 중단하며, 이미 생성된 SMCC 리소스는 Portal에서 확인한다.

스크립트는 GitHub repo `kimhyunbin08/SMCC`의 **Settings → Secrets and variables → Actions → Variables**에 다음을 설정한다. 비밀번호나 secret은 필요 없다.

| 변수 | 값 |
| --- | --- |
| `AZURE_CLIENT_ID` | smcc-deploy managed identity client ID |
| `AZURE_TENANT_ID` | 선택한 Azure tenant ID |
| `AZURE_SUBSCRIPTION_ID` | 선택한 구독 ID |
| `AZURE_RESOURCE_GROUP` | smcc-rg |
| `AZURE_CONTAINER_APP` | smcc-web |
| `AZURE_ACR_NAME` | 생성한 ACR 이름 |

최초 리소스 생성용 임시 quickstart 컨테이너는 실제 SMCC 배포가 아니다. 첫 main push 또는 Actions의 **Test and deploy SMCC → Run workflow**가 SMCC 이미지를 배포하고 라이브 응답의 commit SHA까지 확인해야 완료다. 초기 role assignment 반영에 몇 분 걸릴 수 있어 최초 인증 실패는 권한을 확인한 뒤 workflow를 다시 실행한다.

이후 수정:

```bash
git add .
git commit -m "Update SMCC"
git push origin main
```

`.github/workflows/deploy.yml`가 테스트 후 SHA 태그 이미지를 ACR에 올리고 리비전을 교체한다. CI 완료까지 보통 수 분 걸리며 실시간 파일 동기화는 아니다. PR은 테스트만 한다. 워크플로 로그에서 배포 URL과 실패 이유를 확인한다.

## Azure Portal 확인

https://portal.azure.com → **Resource groups → smcc-rg → smcc-web**:

- **Overview → Application URL**: 실제 웹앱 접속.
- **Revisions and replicas**: 활성 리비전과 배포 상태 확인.
- **Containers**: 현재 이미지 SHA와 `APP_REVISION` 확인.
- **Ingress**: 외부 HTTPS, 대상 포트 3000.
- **Scale**: 최소 0, 최대 1. 유휴 시 콜드 스타트 가능.
- **Identity**와 ACR **Access control (IAM)**: pull identity 확인.

## 비용과 롤백

Container Apps Consumption은 사용량 기반이며 ACR Basic은 앱이 쉬어도 기본 요금이 있다. 비용은 지역·구독·무료 할당량에 따라 다르므로 Portal **Cost Management**에서 확인하고 예산 알림을 설정한다. 무조건 무료가 아니다. 로그 workspace는 초기 뼈대에 생성하지 않는다.

롤백은 이전 성공한 workflow의 SHA를 확인해 실행한다:

```bash
ACR=$(gh variable get AZURE_ACR_NAME --repo kimhyunbin08/SMCC)
SERVER=$(az acr show --name "$ACR" --query loginServer -o tsv)
SHA='<이전 성공한 전체 commit SHA>'
az containerapp update --resource-group smcc-rg --name smcc-web \
  --image "$SERVER/smcc:$SHA" --set-env-vars "APP_REVISION=$SHA"
```

서비스를 완전히 종료할 때만 Portal에서 **smcc-rg** 안의 프로젝트 리소스를 확인하고 해당 리소스 그룹을 삭제한다. 다른 그룹은 삭제하지 않는다.
