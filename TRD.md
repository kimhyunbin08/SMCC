# SMCC TRD

## 최소 구조

Node.js 24 LTS 내장 HTTP 서버와 HTML/CSS만 사용한다. 외부 런타임 의존성, 프런트엔드 빌드 단계, DB, 로그인, AI SDK는 없다.

| 경로 | 역할 |
| --- | --- |
| `src/server.js` | 명시적으로 허용한 정적 파일과 상태 엔드포인트 |
| `public/` | 한국어 소개 페이지와 반응형 스타일 |
| `test/server.test.js` | 기본 HTTP 계약과 정적 파일 노출 방지 확인 |
| `Dockerfile` | 비루트 Node 컨테이너, 포트 3000, health check |
| `docker-compose.yml` | 로컬 단일 web 서비스 |
| `.github/workflows/deploy.yml` | PR 테스트, main 테스트 후 Azure 배포 |
| `scripts/setup-azure.sh` | 프로젝트 전용 Azure 리소스와 OIDC 최초 설정 |

## HTTP 계약

`GET /`는 HTML, `GET /styles.css`는 CSS, `GET /healthz`는 `{ "status": "ok", "service": "smcc", "revision": "..." }` JSON을 반환한다. HEAD도 지원하며 그 외 경로는 404, 지원하지 않는 메서드는 405다. 포트는 `PORT` 환경 변수(기본 3000)이며 0.0.0.0에 바인딩한다. 서버 종료 시 새 요청을 막고 연결을 정리한다. 파일 읽기 오류는 stderr에 기록하고 500을 반환한다.

## 배포 결정

Docker Compose는 **로컬용**이다. Azure App Service Compose는 preview이며 2027-03-31 종료 예정이다. 신규 서비스에 종료 예정 기능을 쓰지 않고 **Azure Container Apps Consumption**에 동일 Dockerfile의 단일 이미지를 배포한다. Azure가 Compose YAML을 그대로 실행하는 구성은 아니다. Azure Portal에서 생성된 리소스와 리비전을 관리할 수 있다.

이미지는 Azure Container Registry Basic에 저장한다. Container Apps는 0.25 vCPU, 0.5 GiB, 최소 0·최대 1 replica로 설정한다. 유휴 시 scale-to-zero이므로 콜드 스타트가 있고 ACR Basic은 상시 요금이 발생한다. 무료 배포를 보장하지 않는다. 외부 HTTPS ingress와 포트 3000을 사용한다.

GitHub Actions는 main 전용 federated credential과 user-assigned managed identity로 Azure에 로그인한다. 비밀번호·publish profile·장기 secret은 사용하지 않는다. 배포 identity는 프로젝트 리소스 그룹의 Contributor와 해당 ACR의 AcrPush이며 다른 그룹이나 구독 전체에 권한을 주지 않는다. 별도 pull identity는 해당 ACR의 AcrPull만 가진다. 구독/tenant/client ID 등 비밀이 아닌 설정은 GitHub Actions variables로 저장한다.

OIDC subject는 GitHub API의 실제 repository subject prefix를 사용한다. 새 저장소의 immutable subject에는 owner/repository ID가 포함되므로 이름만으로 subject를 조립하지 않는다. custom subject 정책은 자동으로 추정하지 않고 명시적 설정을 요구한다.

배포는 테스트 → linux/amd64 이미지 빌드 → commit SHA 태그로 push → Container Apps 단일 리비전 업데이트 → `/healthz`의 실제 SHA 확인 순이다. PR에서는 Azure 로그인/배포를 수행하지 않는다. 스켈레톤에는 영속 데이터가 없다. 컨테이너 안을 Portal에서 직접 수정하지 않고 원본 코드를 push한다.

## 검증 및 운영

로컬 `npm test`, `docker compose config --quiet`, Compose HTTP 응답 및 컨테이너 health를 확인한다. CI는 이미지 빌드도 확인하고 배포 후 실제 SHA가 일치하는지 확인한다. 이전 이미지 SHA로 `az containerapp update --image ... --set-env-vars APP_REVISION=...`하여 롤백할 수 있다. 자세한 실행·Portal·비용·설정은 [README.md](README.md)를 따른다.

## 공식 근거

- [App Service Compose 제한 및 종료 일정](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container#configure-multi-container-apps)
- [Container Apps GitHub Actions 배포](https://learn.microsoft.com/en-us/azure/container-apps/github-actions)
- [Managed identity로 ACR 이미지 pull](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
