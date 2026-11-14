# 서울모닝커피클럽 · SMCC

모닝 커피챗을 보완하는 **작은 개인 프로젝트 MVP**. 아이디·비밀번호, 링크 프로필, 호스트 팀, 초대 직접 가입, 동의된 프로필, 팀 공지·인박스·본인 읽음을 제공한다. LinkedIn 가져오기·AI·후기/피드백 화면은 미구현이며 기존 개선 순환 기획을 보존한다. 기존 기획은 [ideation.md](ideation.md), 요구사항은 [PRD.md](PRD.md), 구조는 [TRD.md](TRD.md), 작업 기준은 [AGENTS.md](AGENTS.md)에 있다.

기존 [smcc.global](https://smcc.global/)과 별개의 보조 프로토타입이다. 기존 사이트를 변경하거나 도메인을 연결하지 않는다.

## 배포 상태

0.5 MVP의 [호스트 관점](https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io/host) / [게스트 관점](https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io/guest)은 로그인 없이 가상 기능을 공유/체험한다. 메모리 변경만 사용하고 실제 데이터를 읽거나 권한을 주지 않는다. `서비스로 이동하기`는 [실제 서비스](https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io/service)의 비회원 탐색을 연다.

초기 실제 배포: [SMCC 프로토타입 열기](https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io/).
[성공한 main 자동 배포](https://github.com/kimhyunbin08/SMCC/actions/runs/43535519925)에서 이미지 빌드·OIDC 로그인·리비전 교체·라이브 SHA 확인을 완료했다. Azure CLI의 기존 조직 이메일 계정과 tenant를 확인했으며 배포는 요청한 **innodge 조직 컨텍스트**의 `smcc-rg`에 있다. 개인 이메일 주소나 인증 정보는 문서에 기록하지 않는다.

GitHub 저장소는 [kimhyunbin08/SMCC](https://github.com/kimhyunbin08/SMCC)를 유지한다. 기존 smcc.global 도메인이나 다른 프로젝트 리소스는 변경하지 않았다. 새로운 조직 로그인이나 리소스 이동은 필요하지 않으며, main push 자동 배포를 그대로 사용할 수 있다.

## 실제 서비스 이용

홈/커피챗/카페/프로필 탭을 비회원으로 탐색한다. 호스트는 로그인 후 커피챗 탭에서 팀을 만들고 **공개 목록 게시**를 별도 선택한다. 과거 초대 전용 팀은 비공개 유지, 제목·일정·별도 공개 장소·정원 합계만 게시한다. 상세 장소/카드/신청/인박스는 공개 탐색에서 숨긴다. 카페는 호스트 제공 공개 장소 안내이며 검증된 카페 목록이 아니다.

신청은 **비회원으로 신청 / 로그인하고 신청**이다. 비회원 별칭·선택 소개·동의/14세 이상 확인을 실제 저장하고 호스트가 자기 팀 접수를 확정/거절한다. 난수 관리 링크로 상태 확인/철회, 분실 자동 복구·메일은 없다. 확정해도 카드/상세 장소/인박스 권한이 생기지 않는다. 기존 호스트 안내 채널로 연락/장소를 확인한다. 회원은 로그인 후 원래 커피챗에서 고지 확인·직접 참여한다.

대기/확정 비회원과 회원/호스트가 정원 공유, 접수≠참석 확정이다. 거절/철회는 좌석 해제·이름/소개 삭제, 최소 상태는 종료+30일 정리다. 누적64개/팀·새 접수5/IP/시간 제한이 있다.

## 로컬 실행 방법

Node.js 24 이상(실제 기능은 Compose 권장):

```bash
npm ci --ignore-scripts
APP_MODE=local DB_PATH=./smcc.sqlite PUBLIC_ORIGIN=http://localhost:3000 npm start
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

SQLite 파일은 `smcc-data` named volume에 저장되어 컨테이너 교체 후에도 유지된다. `down --volumes`는 데이터를 없애므로 사용하지 않는다. 로컬에는 가상 정보만 입력한다. `APP_MODE`/스토리지 설정 없이 실행하면 읽기 전용이다.

이전 시험의 가입 제한이 남아 있으면 실제/기존 볼륨을 지우거나 rate를 완화하지 않고 `HOST_PORT=3187 docker compose -p smcc-e2e up --build -d --wait`로 격리 시험 프로젝트를 실행한다. 먼저 같은 포트의 기본 Compose를 종료한다. 시험 후 가상 fixture를 cleanup/verify로 삭제하고 `HOST_PORT=3187 docker compose -p smcc-e2e down`한다.

단위·통합·HTTP E2E는 `npm test`로 실행한다.

모바일 브라우저 E2E(가상 메모리 DB,3190)는 아래로 실행한다. 브라우저는 SMCC 내부 ignore 경로에 설치하고 CI도 이 테스트 통과 후 배포한다.

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npm run test:browser
```

실제 컨테이너/배포 E2E와 재시작 영속성은:

```bash
TEST_BASE_URL=http://localhost:3000 npm run test:live
docker compose restart
TEST_BASE_URL=http://localhost:3000 TEST_PHASE=verify npm run test:live
```

가상 계정만 만들며 `.mvp-verification.json`은 chmod600/ignore 대상이다. verify는 프로필·멤버십·공지·읽음을 확인하고 계정/팀과 fixture를 삭제한다. 중간 실패 시 원인을 고친 뒤 verify 또는 `TEST_PHASE=cleanup`을 실행한다. 복구 코드/암호를 로그·GitHub에 올리지 않는다.

`TEST_SCOPE=service`는 가상 호스트/회원2명과 비회원 영속 접수·중복 재시도·공개 필터·확정/철회까지 검사한다. verify는 재시작 뒤 신청/공지/읽음 보존을 확인하고 전부 정리한다. 가입5/IP/시간 제한으로 반복 시험이 막히면 보호를 낮추지 말고 만료 후 다시 시도한다.

main 배포 CI도 이 가상 회원/비회원 E2E를 수행하고 해당 SMCC 리비전만 재시작해 영속성을 확인한 뒤 fixture를 삭제한다. 잠깐의 재시작/콜드 스타트가 있을 수 있다. 실패 시 cleanup을 시도하고 배포 검증을 성공으로 표시하지 않는다. 실제 회원 자료를 시험 대상으로 쓰지 않는다.

## 영속 저장·운영 설정

조직 승인을 받아 `smcc-rg`의 한국 중부 `smccdata116481c1a3` StorageV2 Standard_LRS / `smccdata` table을 사용한다. Container Apps의 임시 디스크가 아니다. 기존 앱 identity에 해당 table 범위의 데이터 권한만 있으며 Shared Key는 꺼져 있다. `TABLE_ENDPOINT`, `TABLE_NAME`, `STORAGE_CLIENT_ID`, `PUBLIC_ORIGIN`을 앱 설정으로 유지한다.

사용자가 지정한 개인 프로젝트 운영자·문의 연락처는 Container Apps secretref `OPERATOR_NAME`, `SUPPORT_EMAIL`에서 제공하고 공개 저장소에는 넣지 않는다. 영속 저장소·운영 정보·`REGISTRATION_ENABLED=true`가 있어야 공개 가입이 열린다. `/privacy`, `/terms`는 실제 설정을 치환해 제공한다. 법률 준수 인증이 아니며 Microsoft 계약·지원 접근·운영 로그 처리의 법적 검토는 별도로 필요하다.

LinkedIn 활성화에는 공식 개발자 앱의 Sign In with LinkedIn using OpenID Connect 제품 승인, client ID/secret, HTTPS callback, state/token/소유권 검증과 연결 해제가 필요하다. 일반 OIDC는 subject/name/photo와 선택 email 범위이지 경력/학력 전체가 아니다. 현재는 수동 SNS URL만 저장하고 스크래핑/AI 추측을 하지 않는다.

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

2026-11-14 공식 [Table 가격 페이지](https://azure.microsoft.com/en-us/pricing/details/storage/tables/)의 `korea-central` embedded regional price를 직접 확인했다. 서비스 범위 Microsoft 관리 암호화/LRS는 **$0.0495/GB·월 + $0.00036/10,000 transactions**이다. Retail API는429였으므로 공식 HTML 데이터를 사용했다. 계정 범위 키 암호화의 별도·더 높은 작업별 가격과 혼동하지 않는다.

작은 파일럿 가정: 총 저장량0.1~1GB, 월100,000 Table 작업이면 새 저장소 약 **$0.00855~$0.0531/월**(USD, 세금·환율·계약 할인·네트워크/지원 별도)이다. 작업 수에는 실제 GET/scan/write/delete/재시도/유지보수를 모두 포함한다. 기존 Container Apps·ACR 비용은 이 증분 추정에 포함하지 않는다. 실제 청구는 Cost Management에서 확인하며 예산/알림은 하드 한도나 자동 차단이 아니다. 이 승인은 다른 유료 서비스·업그레이드를 포함하지 않는다.

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
