# SMCC TRD

## 현재 기본 MVP 기술 계약

### 0.5 MVP 공개 체험

`/`, `/host`, `/guest`, `/login`은 allowlist HTML shell을 제공한다. `public/app.js`는 공개 관점에서 `public/demo.js`를 메모리 전용으로 렌더링하고 API를 호출하지 않는다. 실사용 CTA는 `/service`의 비회원 탐색 탭으로 이동한다. 회원 작업/신청 선택 시 `/login?tab=...&chat=...`로 이동하고 성공 후 allowlist `/service` 내부 탭·선택 모임으로 복귀한다. URL 역할을 서버 auth/role로 승격하지 않는다.

가상 체험 상태는 해당 페이지 인스턴스의 변수이며 localStorage/cookie/DB에 저장하지 않는다. 체험 데이터는 직접 작성한 가상 예시이고 임의 HTML은 escape한다. 변경 시 서버 저장이 아니라는 상태 안내를 제공한다. 모듈 스크립트와 `/demo.js`만 추가로 allowlist한다. 실제 초대 경로와 프로필 공개 API의 권한/동의 동작은 그대로 유지한다.

단일 Node.js 24 HTTP 앱과 HTML/CSS/JavaScript를 유지한다. 메일·LinkedIn 앱이 없으므로 이메일 OTP/SSO/가져오기는 구현하지 않는다. Azure 인증·Table 데이터 접근에만 공식 `@azure/identity`, `@azure/data-tables` SDK와 lockfile을 사용하며 프런트엔드 빌드는 없다.

`src/database.js`는 로컬 SQLite key/value 레코드를 파일/WAL/Compose 볼륨에 저장한다. `src/table-store.js`는 동일한 `get/list/create/mutate/remove/check` 계약을 Azure Table에 구현한다. `users`, `sessions`, `teams`, `announcements`, `receipts`, `rates`는 별도 partition이며 팀의 최대 30명 멤버십은 동일 entity 안에 있어 정원·초대 회전·탈퇴를 ETag 조건부 Replace로 원자 처리한다. 충돌은 최신 데이터를 읽어 유한 재시도하며 장애를 빈 성공으로 바꾸지 않는다.

작은 파일럿을 위해 팀/공지 partition을 조회한 뒤 서버에서 권한 필터링한다. 응답에 원본 전체 entity·암호·초대 hash·멤버십 map을 직렬화하지 않는다. 대규모 인덱스·큐·마이크로서비스는 추가하지 않으며 사용자/팀 증가 시 조회량·비용을 확인해야 한다.

계정 생성은 아이디 hash 키의 create-only로 유일성을 보장한다. scrypt N32768, 난수 salt, 32byte 복구 코드 hash, auth_version으로 암호 변경 전 세션을 즉시 무효화한다. 비동기 암호 검증 후 최신 auth_version을 다시 확인해 오래된 인증으로 변경하지 않는다. 세션 쿠키는 HttpOnly/Secure/SameSite=Strict, 7일이며 상태 변경은 Origin·CSRF와 JSON 최대16KiB 검증을 적용한다. 로컬 HTTP에만 Secure를 끈다.

삭제는 먼저 사용자/팀을 비활성화해 접근을 차단하고 관련 partition을 정리한다. cross-partition SQL transaction이 있다고 주장하지 않는다. 장애는503으로 보고하고 삭제 표식을 시작/30분 유지보수에서 재처리한다. 이름·소개·암호가 없는 삭제 아이디 hash 예약만30일 남겨 재사용으로 과거 권한이 연결되지 않게 한다. 종료+30일 팀/공지/읽음과 만료 세션·rate도 같은 작업에서 정리한다. scale-to-zero 중에는 정리가 늦을 수 있고 상대 프로필 접근은 매 요청 현재 시각으로 제한한다.

| API | 실제 역할 |
| --- | --- |
| GET `/api/status`, `/readyz` | 저장소 실제 연결 확인. 미설정/장애는 기능 비활성 또는503 |
| POST `/api/register`, `/api/login`, `/api/logout`, `/api/recover`, `/api/password` | 계정/인증, 복구·암호 교체 |
| GET `/api/me`, PUT `/api/profile`, GET `/api/profiles/:username` | 본인 프로필·명시적 인터넷 공개만 |
| GET/POST `/api/teams`, GET/DELETE `/api/teams/:id` | 본인 팀 목록·호스트 생성/삭제·멤버 상세 |
| GET `/api/invites/:token`, POST `/api/join` | 장소/프로필 없는 안내와 고지 확인 직접 가입 |
| PUT `/api/teams/:id/sharing`, POST `/api/teams/:id/leave`, `/rotate`, `/close` | 공유·참가·자기 호스트 초대 관리 |
| POST `/api/teams/:id/announcements`, GET `/api/inbox`, POST `/api/inbox/:id/read` | 자기 팀 공지·멤버 인박스·본인 읽음 |
| DELETE `/api/account` | 현재 암호 확인 후 차단/삭제 |

`/healthz` 기존 status/service/revision 계약은 유지한다. `/`, `/styles.css`, `/app.js`, `/invite/:token`, `/p/:username`, `/privacy`, `/terms`만 정적 allowlist로 제공한다. 운영자/문의 템플릿은 런타임에서 치환하고 다른 Markdown·source·환경 파일은 공개하지 않는다.

Azure는 `smcc-rg`의 `smccdata116481c1a3` Standard_LRS/한국 중부와 `smccdata` table을 사용한다. Shared Key는 비활성, HTTPS/TLS1.2 필수, 기존 앱 identity에 해당 table 범위의 Storage Table Data Contributor만 부여한다. `TABLE_ENDPOINT`, `TABLE_NAME`, `STORAGE_CLIENT_ID`, `PUBLIC_ORIGIN`, 운영자/문의 secretref, `REGISTRATION_ENABLED`를 설정한다. 저장소 없을 때 임시 디스크로 대체하지 않는다.

**이후의 Phase 0/Phase 1은 보존된 이전 구조·확장 제안으로, 현재 API/동의/역할/스토리지와 다른 경우 이 절이 우선한다.**

### 공개 탐색·비회원 신청 계약

추가 allowlist는 `/service`, `/application`, `/ui.js`, `/service.js`다. 공개 목록은 `listed===true`인 소유 호스트 선택 게시만 반환하고 기존 필드 없는 팀은 비공개다. DTO는 id/제목/UTC 일정/별도 공개 장소/정원·합계·신청 가능 여부만 포함하며 `place`·개인 자료·초대 hash·신청 map·공지 등은 제외한다. 카페는 공개 장소만 중복 제거한 호스트 안내이며 외부 레지스트리가 아니다.

| 추가 API | 권한·계약 |
| --- | --- |
| GET `/api/public/teams`, `/api/public/teams/:id` | 호스트 선택 공개 팀 DTO. 목록은 종료/닫기·삭제 호스트 제외 |
| PUT `/api/teams/:id/publication` | 소유 호스트 공개 ON/OFF·별도 공개 장소1~80자. 자동 공개 없음 |
| POST `/api/public/teams/:id/join` | 로그인·고지 확인·선택 팀 공유·원자 정원 검사 |
| POST `/api/guest/applications` | 공개 팀/유효 초대, name1~40·bio0~200·consent/age, 시작 전/닫기/정원 검사 |
| POST `/api/guest/status`, `/api/guest/withdraw` | teamId+난수 receiptToken의 해당 신청만 조회/철회. 회원 자격 없음 |
| POST `/api/teams/:id/guest-applications/:hash` | 소유 호스트만 시작 전 접수 확정/거절 |

`guest_applications[SHA256(receiptToken)]`를 팀 entity에 저장한다. 원문32byte 난수(43자 base64url)는 저장/로그하지 않는다. `received`, `confirmed`는 좌석 사용, `rejected`, `withdrawn`은 해제한다. 정원≤30·누적 비회원 기록≤64; 거절/철회는 name/bio 삭제 후 hash/상태/생성 시각만 보관한다. 이 상한과 최대 Unicode 입력의 UTF-16 직렬화 크기를64KiB 미만으로 검증한다. 회원+비회원 마지막 좌석은 동일 ETag mutation으로 경합한다. 호스트 팀 생성20/시간·새 비회원 접수5/IP/시간, 기존 receipt 재시도는 중복 신청 없음이다.

관리 URL은 `/application?team=<uuid>#<receiptToken>`이며 비밀은 fragment에만 둔다. HTTP path/query/referrer에 보내지 않고 JSON body로 전달한다. 페이지는 no-store/no-referrer이고 외부 분석 호출은 없다. 공개 해제 후에도 본인 최소 상태만 조회하며 삭제/30일 만료는404다. 링크 분실 자동 복구·메일은 제공하지 않는다.

회원 공개/초대 가입 뒤 최신 계정 인증을 재확인하고 동시 삭제된 멤버십을 보상 제거한다. 세션 생성 전후 auth_version 재확인, 프로필 DTO `profileVersion` 및 기대 버전 불일치409, UI는 항상 버전 전송이다. 멤버십 generation을 읽음에 연결해 탈퇴/재가입의 과거 읽음을 상속하지 않는다. 유지보수/탈퇴 receipt·rate 삭제도 조건부 mutation으로 새 기록을 보존한다. `mutate` null은 조건부 삭제/없으면 no-op, JSON null 저장이 아니다. Azure404/409/412만 유한 재시도하고 장애는 실패다.

개발 전용 Playwright 모바일 Chromium E2E는3190의 격리 가상 메모리 DB 서버로 실 기록·rate를 건드리지 않는다. 브라우저 다운로드/보고서는 저장소 내부 ignore 경로, 운영 이미지에서는 제외한다. CI는 단위/통합·브라우저 E2E를 통과한 SHA만 배포한다.

배포 후 실제 Azure URL에서 가상 호스트/회원2명·비회원 접수/재시도·권한 분리를 확인한다. 현재 SMCC 리비전만 재시작하고 영속 계정/프로필/공개 목록/신청/공지/읽음을 확인한 뒤 확정/철회·계정/팀 fixture를 삭제한다. 실패 cleanup trap을 두며 실제 사용자 데이터를 읽거나 정리하지 않는다. 재시작에 따른 짧은 중단/콜드 스타트가 있다.

## 상태와 적용 범위

**현재 릴리스는 아래 기본 MVP 계약을 따른다. Phase 0/Phase 1의 오래된 스켈레톤·차기 설계는 이력으로 보존한다.** 2026-11-14의 문서-only 교차검토 및 이후 사용자 피드백 요청을 반영하며 이 문서로 코드·DB·인증·AI·추가 배포가 완료됐다고 주장하지 않는다. 제품 결정·게이트·수용 기준은 [PRD.md](PRD.md) D01–D13, G01–G04, AC01–AC29다. 후기·개선 순환 추가분은 새 세 모델 검토 결과가 아니다.

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

## Phase 1: 차기 MVP 목표 구조 — 제안, 아직 구현 아님

기존 단일 Node.js 웹앱과 서버 렌더링 HTML 폼에 필요한 경량 라우팅·인증·DB 접근만 추가한다. 별도 SPA, 마이크로서비스, AI 에이전트, 벡터 DB, 큐 플랫폼은 만들지 않는다. 기존 스켈레톤의 외부 의존성 0개 원칙은 **현재 구현 제약**이며 차기 기능에 필요한 검증된 최소 라이브러리까지 금지하는 뜻이 아니다.

| 구성 | 제안 책임 | 도입 게이트 |
| --- | --- | --- |
| 단일 웹앱 | 세션·프로필·멤버십·동의·비공개 피드백·수동 개선 기록, 서버 권한 검사, AI 요청 프록시 | 명시적 구현 지시 |
| 이메일 인증 서비스 | 매직링크 발송·검증, 사용자 식별 | G03 제공자·비용 |
| 외부 관리형 PostgreSQL | 영속 상태·트랜잭션·제약·삭제·백업 | G02·G03 정책/비용 |
| 선택적 LLM API | 제공 텍스트 소개 초안만, 도구·검색 없음 | G04 |
| 기존 Container Apps/ACR/OIDC | 단일 이미지와 조직 컨텍스트 배포 유지 | 새 자원 생성 없이 기본 유지 |

PostgreSQL은 동시 승인과 영속성에 맞춘 목표 선택이지 이미 생성된 DB가 아니다. Container Apps의 로컬 디스크·SQLite 파일을 영속 저장소로 삼지 않는다. 인증·DB의 실제 제품/지역/규격은 G03 이후 결정하며 추측한 자원명·자격 증명은 코드에 넣지 않는다.

## 데이터 모델과 불변 조건

| 엔터티 | 최소 필드/역할 | 제약 |
| --- | --- | --- |
| User | UUID, 인증 제공자 subject, 본인 이메일, 활성/삭제 상태, 최종 로그인 | 이메일은 인증용 비공개. 자동 호스트 권한 없음 |
| Profile | user_id, 호칭, 소개, 선택 직무·주제·HTTPS 링크, version | 계정당 1개. AI 원문·미승인 초안 없음 |
| Session | UUID, host_user_id, 제목, starts_at/ends_at/deadline, timezone, 공개 안내/상세 장소, capacity, status, invite_token_hash | 호스트 1명. UTC 저장, Asia/Seoul 표시. PRD 시각/정원 제약 |
| Membership | session_id, user_id, status, peer_fields, consent_version/consented_at, 신청·상태 시각 | session_id + user_id 고유. team 테이블 없음 |
| 멤버십 상태 이력 | membership_id, 이전/이후 상태, 전이 시각 | 종료 당시 피드백 자격 판정용 최소 기록. 프로필 없음, 세션 종료 후 30일·계정 삭제 때 정리 |
| 최소 운영 기록 | 임의 이벤트 ID, 행위 유형, 시각, 삭제 기한 | 본문·토큰·이메일·소개·링크 기록 금지, 보관 정책 필요 |
| Feedback | session_id, author_user_id, respondent_type, topic_codes, liked_text, improve_text, version, 전달 고지 동의/시각, 생성/수정 시각 | session_id + author_user_id 고유. host/participant 구분, 프로필 복제 없음 |
| ImprovementNote | session_id, 주제·행동·담당·상태·점검일·보류 이유, 작성 시각 | 운영자 수동 검토. 응답 원문·작성자 FK/인용 없음, 90일 기한 |

Profile은 실시간 재사용 원본이고 Membership은 공개 항목과 동의 기록만 갖는다. 과거 소개 스냅샷을 만들지 않는다. 사용자 편집 시 version을 증가시키고 참여 중인 활성 세션에 적용됨을 UI에서 안내한다. `peer_fields`의 허용 필드는 서버 allowlist로 제한한다.

신청용 호스트 항목은 활성 신청·확정 상태의 호칭·소개·입력한 직무·주제이며, 본인 이메일·소셜 링크·AI 재료를 자동으로 포함하지 않는다. 호스트는 참가자 프로필을 수정하지 못한다. 종료·취소·거절·탈퇴·제외 상태는 상대방 프로필 권한을 제거한다.

## 상태·동시성 계약

신규 신청은 인증·세션 `open`·마감 전을 검사한다. Session 행을 잠근 트랜잭션 안에서 신청 상태를 다시 확인해 취소·마감 경쟁 뒤 신청이 생기지 않도록 한다. 중복 요청은 고유 제약으로 동일 Membership을 반환하고 중복 좌석을 만들지 않는다. 거절·탈퇴·제외 레코드를 자동으로 `applied`로 되살리지 않는다.

호스트 승인 요청은 자기 세션·`applied`·시작 전·세션 `open` 또는 `closed`를 검사한다. **트랜잭션에서 Session 행을 잠근 뒤 현재 confirmed 수와 capacity를 검사하고 상태를 변경**한다. 승인·탈퇴·제외·정원 변경은 동일 잠금 규칙을 사용한다. 경쟁 요청의 마지막 좌석은 하나만 성공하고 다른 요청은 409다. 이미 확정된 동일 요청의 재시도는 같은 결과이며 정원 증가를 일으키지 않는다.

세션 취소·승인 경쟁도 같은 Session 잠금으로 직렬화한다. 권한 결정은 DB 상태와 서버 현재 시각을 함께 사용한다. 마감·시작·종료를 백그라운드 작업이나 UI 시계에만 맡기지 않는다. 시작 후 승인/정원 변경은 거부, 종료 후 상대방 프로필 조회는 거부한다.

첫 신청 뒤 Session 시각·장소 수정은 거부한다. 제목·안내의 오탈자 수정은 가능하지만 중요한 변경은 기존 DM 공지 책임을 안내한다. 초대 회전은 token hash만 교체하고 기존 Membership은 유지한다.

## 인증·초대·권한 경계

이메일 매직링크 목표는 10분 유효·일회용이며, 제공자 검증 없이 직접 URL에서 이메일을 신뢰하지 않는다. 제공자가 이 계약을 지원하는지 G03에서 확인한다. 서버 세션 쿠키는 Secure·HttpOnly·SameSite=Lax, 7일 최대 수명 제안이며 로그인·로그아웃·계정 삭제 시 회전/폐기한다.

초대 토큰은 CSPRNG 128bit 이상, URL-safe이며 DB에는 hash를 보관한다. 공개 Session UUID를 안다고 초대 방문자용 안내 권한을 얻지는 않는다. 유효 초대 링크는 기본 안내와 신청 시작만 허용한다. 상세 장소와 참가자 응답은 인증·멤버십·시각 권한을 별도로 확인한다.

매 서버 요청에서 PRD 권한 표를 적용한다. 로그인 전 상태성 데이터 요청은 401, 로그인 후 다른 세션·미확정·권한 회수는 403 또는 정보 비노출을 위한 404다. 오류 응답에 이름·장소·프로필을 첨부하지 않는다. 상대방 데이터는 허용 필드로 새 응답 객체를 구성하고 원본 레코드를 직렬화한 뒤 UI에서 숨기지 않는다.

상태 변경은 GET으로 처리하지 않고 CSRF 토큰과 Origin 검증을 적용한다. 입력 길이·필드·시각·HTTPS 링크를 서버 검증하며 HTML은 평문 escape 렌더링한다. 링크는 외부 이동 안내와 `noopener noreferrer`, 참가자 응답은 `Cache-Control: no-store`, 초대 페이지는 `Referrer-Policy: no-referrer`를 목표로 한다. 캐시가 동의 철회·탈퇴 전 값을 새 응답에 재노출하지 않도록 한다.

운영자의 호스트 지정은 제한된 역할 부여 작업으로만 시작한다. 운영 지원 접근은 명시적으로 승인된 최소 범위·기록이 필요하며 일반 호스트 권한으로 다른 세션 전체를 열람하지 않는다. 공개 운영자 콘솔은 범위 밖이다.

## 차기 API 계약 — 제안, 현재 서버에는 없음

| 메서드/경로 | 책임 | 권한/주요 실패 |
| --- | --- | --- |
| GET `/s/:token` | 링크용 기본 안내 | 유효 hash, 회전/없는 링크 404. 타인 정보 없음 |
| POST `/auth/email` | 본인 확인 링크 발송 | 발송 횟수 제한, 계정 존재 여부 비노출 |
| GET `/auth/callback` | 인증 제공자 callback 검증 | 만료·재사용·위조 거부, state 검증 |
| POST `/auth/logout` | 서버 세션 폐기 | 현재 세션, CSRF 검증 |
| POST `/api/sessions` | 초안 작성 | 지정 호스트, 입력 오류 400 |
| GET `/api/sessions/:id` | 본인의 세션 안내·상태 | Membership/자기 호스트. 상세 장소는 현재 확정자/호스트만 |
| PATCH `/api/sessions/:id` | 허용된 안내/정원 수정 | 자기 호스트, 첫 신청 뒤 시각·장소 불변, 정원 검사 |
| POST `/api/sessions/:id/publish` | 모집 시작·링크 발급 | 자기 호스트, 상태 충돌 409 |
| POST `/api/sessions/:id/close` | 신규 신청 수동 마감 | 자기 호스트, 대기 승인은 시작 전 가능. 재모집 없음 |
| POST `/api/sessions/:id/applications` | 프로필/고지 확인 후 신청 | 인증+유효 초대+마감 전, 중복은 같은 신청 |
| POST `/api/sessions/:id/members/:userId/confirm` | 원자 승인 | 자기 호스트, 정원/상태 충돌 409 |
| POST `/api/sessions/:id/members/:userId/reject` | 대기 신청 거절 | 자기 호스트, 확정 상태는 거절 아닌 제외 |
| POST `/api/sessions/:id/members/:userId/remove` | 확정 참가자 제외 | 자기 호스트, 좌석/권한 회수 |
| POST `/api/sessions/:id/withdraw` | 본인 탈퇴 | 본인, 재시도 같은 최종 상태 |
| PATCH `/api/sessions/:id/consent` | 공개 항목 변경·철회 | 본인 Membership, 참여 상태 불변 |
| GET `/api/sessions/:id/participants` | 동의된 프로필 보드 | 현재 확정+종료 전, host 심사 목록과 분리 |
| GET `/api/sessions/:id/applications` | 자기 세션 신청 관리 | 자기 호스트, 제출된 심사용 항목만 |
| PATCH `/api/profile` | 본인 프로필 편집 | 인증, version 충돌 409 |
| POST `/api/profile/draft` | 선택적 AI 초안 | 동의·G04 flag·quota, 실패 422/429/503/504 |
| POST `/api/sessions/:id/rotate-invite` | 초대 회전 | 자기 호스트, 기존 Membership 유지 |
| POST `/api/sessions/:id/cancel` | 세션 취소 | 자기 호스트, 모든 상대방 열람 회수 |
| GET `/api/sessions/:id/feedback/mine` | 본인 피드백/제출 가능 상태 | 본인만, 종료 세션에서도 상대방 정보 없음 |
| PUT `/api/sessions/:id/feedback/mine` | 본인 제출·기한 내 수정 | 종료 당시 대상자, 7일 미만, 동의/길이/version 검사 |
| DELETE `/api/sessions/:id/feedback/mine` | 본인 피드백 삭제 | 본인, 제출 창 이후에도 보관 중 가능 |
| GET `/api/sessions/:id/feedback-summary` | 자기 호스트용 주제별 집계 | 참가자 응답 최소 5개. 원문·작성자 없음 |
| GET `/api/sessions/:id/feedback-review` | 배정 세션의 원문 검토 | 지정 검토자만, author/profile/email 필드 제외 |
| GET/POST `/api/sessions/:id/improvements` | 개선 메모 조회/수동 작성 | 조회는 자기 호스트/배정 검토자, 작성은 검토자 |
| PATCH `/api/sessions/:id/improvements/:noteId` | 과제 상태·점검·보류 이유 갱신 | 배정 검토자, 해당 세션 note만 |
| DELETE `/api/account` | 계정 삭제 요청 | 본인 재확인, 즉시 차단+삭제 기한 |

기존 `/healthz`는 스켈레톤의 생존·배포 SHA 계약으로 유지한다. 차기 DB 준비 상태 `/readyz`는 필요한 경우 별도 제공하고 DB 장애 시 503을 반환한다. 기존 `/healthz`를 DB 성공처럼 오해하거나 참가자 데이터 오류를 빈 성공 응답으로 덮지 않는다.

## 사후 피드백·개선 경계 — 사용자 요청 후 추가 설계

PRD D13에 따라 취소되지 않은 세션의 종료 시각부터 7일 미만 동안 작성/수정한다. 제출 자격은 종료 당시 `confirmed`였던 계정 또는 자기 호스트이며 실제 출석 증명은 아니다. 상태 변경 이력의 시각으로 종료 당시 멤버십을 판정하므로, 종료 뒤 탈퇴로 자격을 잃거나 종료 전 탈퇴자가 얻지 않는다. 종료 상태 갱신 작업 지연에도 서버 현재 시각과 이력을 사용하며 계정 삭제자는 접근 불가다. 이 자격 조회가 기존 참가자 API의 종료 제한을 우회하지 않는다.

동일 세션·작성자의 Feedback 고유 제약과 version 검사로 중복·덮어쓰기를 막는다. 호스트가 참가자로 확정되어도 respondent_type은 host 하나이며 참가자 집계에서 제외한다. 주제 allowlist, 텍스트 각각 500자, 최소 하나의 응답 필드를 검증하고 비신뢰 평문으로 렌더링한다. 본인 삭제·계정 삭제·purge는 응답 제거와 집계 무효화를 함께 처리한다.

피드백용 접근 규칙을 프로필 권한과 분리한다. 배정된 검토자만 세션 원문을 읽으며 응답 객체는 작성자 식별자·프로필·이메일·원본 상태 레코드를 제외한다. 검토자가 그 세션 호스트인 경우 참가자 원문 열람은 허용하지 않고 별도의 검토자를 배정해야 한다. 지원/호스트 역할만으로 전체 원문 열람을 허용하지 않는다. 접근 기록에는 원문·작성자·토큰을 넣지 않는다.

호스트 집계는 현재 참가자 응답 수 5개 이상일 때 주제별 결과만 반환하고 미달 시 세부 수치·원문·제출자 목록 없이 `insufficient_responses`를 표시한다. host 응답 제외, 필터/시각별 분석 금지, 삭제 후 재검사, `no-store`를 적용한다. 검토자는 소수 응답에서도 식별 단서 없는 일반 개선 과제를 수동 작성할 수 있지만 원문을 복제·인용하지 않고 재식별 가능 내용은 전달하지 않는다. 이는 익명성 보장이 아니다.

ImprovementNote는 주제·행동·담당·`reviewing/planned/implemented/deferred`·다음 점검·보류 이유만 기록한다. 담당은 작업 책임이지 호스트 평점이 아니며 사람 순위·공개 리뷰·AI 요약·외부 내보내기는 없다. 최소 배정형 검토 화면만 제안하며 전체 운영 콘솔이나 분석 서비스를 추가하지 않는다. DB 장애는 실패로 응답하고 후기 저장 성공처럼 처리하지 않는다.

피드백 원문/계정 연결은 세션 종료 후 30일, 수동 비식별 메모는 작성 후 90일 purge 제안이다. 본인 삭제와 계정 삭제는 24시간 내 운영 DB에서 제거하고 기존 백업 최대 30일 및 복구 후 재삭제 계약을 적용한다. 식별 가능한 파생 메모도 삭제 대상이며 비식별 메모를 원문 보관 연장 수단으로 쓰지 않는다. 정책 확정은 G01/G02에 남긴다.

## AI 경계와 장애 계약

`AI_ENABLED` 목표 기본값은 false다. G04 승인 전 실제 호출하지 않는다. provider/model은 정책 승인 후 서버 설정이며 브라우저에 API 키를 보내지 않는다. AI 호출은 인증 본인의 제공 텍스트만 사용한다. 소셜 링크 fetch, 브라우징, 파일 도구, 다른 참가자 정보, 초대 토큰, 이메일은 요청에 넣지 않는다.

입력 1,000자·결과 400자·사용자 하루 3회 시도·10초 timeout은 PRD와 같다. 일일 창은 Asia/Seoul 날짜 기준이다. 실제 제공자 호출 전 DB 등 영속 공유 저장소에서 원자적으로 횟수를 예약하며 재시작으로 초기화하지 않는다. 동일 생성 request ID의 재시도는 추가 호출·차감을 하지 않는다. 제공자 실패·timeout도 예약 횟수에 포함하고 미동의·입력 오류·비활성은 차감하지 않는다. 월 비용 한도는 계정 전체 설정으로 확정하며 quota 거부·키 미설정·G04 미승인은 명시적 실패다. AI 실패가 신청 API 실패로 전파되지 않도록 분리한다.

시스템 지시와 본인 텍스트를 구조적으로 분리하되 인젝션 방지·사실성 보장을 주장하지 않는다. 출력 역시 비신뢰 평문으로 검증하고 안전하지 않은/빈/과도한 결과는 실패로 처리한다. 사용자는 항상 직접 편집·폐기할 수 있다.

클라이언트 편집 version과 생성 request ID를 비교하여 늦은 응답을 자동 적용하지 않는다. 초안 생성 요청은 DB Profile을 갱신하지 않으며 명시적 승인 저장 요청에서만 version 확인 후 원본을 변경한다. 미승인 초안과 원문은 앱 DB/로그에 보관하지 않는 목표지만 제공자 측 retention/학습 정책은 G04에서 별도 확인한다.

## 오류·운영·데이터 수명

오류는 한국어 사용자 메시지와 비식별 request ID를 제공하고 서버에 분류/시각/지연/상태만 기록한다. 프로필 본문·이메일·초대 URL/token·AI 입력·인증 헤더는 로그에서 제외한다. 로그인 발송 실패, DB 장애, 정원 충돌, AI 장애를 서로 구분하고 성공 모양으로 반환하지 않는다.

차기 상태 데이터는 외부 DB에만 저장한다. schema migration은 호환 변경·백업·롤백 절차와 함께 검증하고, 기존 SHA 이미지 롤백만으로 비호환 DB 변경을 해결했다고 표현하지 않는다. DB secrets는 승인된 Azure secret 참조/managed identity 등으로 공급하며 git·브라우저·이미지에 넣지 않는다.

PRD D09/G02에 맞춰 종료/취소 30일 뒤 최소 기록 purge, 계정 삭제 즉시 권한 회수 및 24시간 내 운영 DB 삭제, 백업 최대 30일 잔존, 로그 30일을 **설계 제안**으로 둔다. 실제 법적 예외·처리 가능성 확정이 선행되어야 한다. 복구 시 삭제 원장/대상 목록을 재적용해 삭제자를 되살리지 않는다. 삭제 원장은 원문 프로필 없이 필요한 최소 식별만 보관하고 자신의 보관 기한도 정책에 포함한다.

주기적 purge가 실패하면 오류를 표시하고 운영자가 확인한다. purge 지연이 참가자 공개 지연으로 이어지지 않도록 열람권은 요청 시각으로 이미 회수한다. 백업 복구 및 purge 검증 환경은 합성 데이터로 시작한다.

## 추적 가능한 차기 검증 계획

| 제품 기준 | 기술 검증 |
| --- | --- |
| AC01–AC08 | 입력/시각/상태 전이, DB 고유 제약, 마지막 좌석 경쟁·재시도 통합 테스트 |
| AC09–AC16, AC23 | 역할·세션 격리·필드 allowlist·공개 철회·초대 회전·종료를 HTTP 응답에서 검증 |
| AC17 | 삭제 작업·권한 회수·DB purge·백업 복구 후 재삭제를 기한별 검증 |
| AC18–AC22 | 가짜 LLM/메일 제공자로 동의·timeout·quota·늦은 응답·악성 텍스트·비fetch 확인 |
| AC24 | 기존 `/healthz` 계약과 이미지 SHA 검증 유지 |
| AC25–AC29 | 종료/7일 경계·종료 당시 자격·host 중복 방지·배정 검토자 권한·집계 4/5/삭제·프로필 비재개·30/90일 purge·수동 개선 상태 검증 |

설계 규모는 세션 30명·동시 20명, 준비된 일반 API p95 500ms 이하·콜드 초대 안내 10초 이하를 목표로 한다. 외부 인증·AI 지연은 별도 측정하며 실패·콜드 스타트를 제외해 좋은 수치처럼 표현하지 않는다.

이번 문서 작업에서는 이 미래 테스트를 실행하지 않는다. 실제 구현 지시 후 단위 → DB/HTTP 통합 → 동의/상태 E2E → 운영 복구 검증 순서로 수행한다. 정책 승인 전 개인정보·유료 자원으로 시험하지 않는다.
