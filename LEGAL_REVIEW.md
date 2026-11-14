# 기본 MVP 법률·운영 검토 메모

2026-11-14. 법률 자문/준수 인증이 아닌 운영 전 체크리스트.

## 확인 근거와 한계

- [국가법령정보센터 개인정보보호법](https://www.law.go.kr/법령/개인정보보호법): 조사 시 시스템 점검으로 현행 조문을 조회하지 못했다. 최신 조문·시행령을 확인했다고 주장하지 않는다.
- [한국법제연구원 영문 법령 서비스](https://elaw.klri.re.kr/eng_service/main.do): 참고 대체 경로이며 번역은 법적 효력 있는 원문이 아니다. 확인 가능한 원문과 전문가 검토로 보완 필요.
- [LinkedIn 공식 OIDC 안내](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2): openid/profile로 subject·이름·사진, email은 별도 scope. 실제 신원 검증이 아니며 경력·학력 전체 권한이 아니다.
- [Azure Table Storage 공식 개요](https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-overview): 사용자의 후속 조직 승인에 따라 SMCC 전용 Standard LRS를 생성했다. 이전 유료 저장소 보류는 이 특정 자원에 한해 해제됐다.
- [개인정보보호 포털의 실제 수집·제공 고지](https://www.privacy.go.kr/front/contents/cntntsView.do?contsNo=44): 공식 서비스에서 목적/항목/보관/거절 효과와 제공 동의를 분리한 안내를 확인했다. 이를 이 앱의 법적 승인으로 간주하지 않는다.
- [Azure 고객 데이터 보호](https://learn.microsoft.com/en-us/azure/security/fundamentals/protection-customer-data): 지원 인력은 기본 접근 불가와 필요한 경우 JIT 접근 원칙, 내부 데이터 보호/삭제 조건을 설명한다. 국내 저장을 모든 지원의 국내 처리 보장으로 표현하지 않는다.

## 이 앱에서 필요한 검토

계정 식별자/프로필/팀 소속/읽음 상태가 개인정보가 될 수 있으므로 처리 목적·최소 항목·근거·기한·파기·권리 요청·안전조치를 구체화해야 한다. 인터넷 공개와 팀 멤버 제공은 범위·목적·항목·거절 효과를 별도로 고지하고 필요한 제공 동의/근거를 확인해야 한다. Azure 위탁·지원/로그 지역·국외 처리 가능성은 실제 약정과 구성으로 검토한다.

만 14세 미만 법정대리인 동의 운영을 구현하지 않아 가입에서 만 14세 이상만 확인한다. 자기 신고만으로 연령을 검증했다고 주장하지 않는다. 운영 주체와 문의 창구는 사용자가 개인 프로젝트 기준으로 지정했으며 runtime secretref에만 저장한다. 기존 SMCC나 Azure 조직의 공식 운영자로 추정하지 않는다. 수탁자/국외 지원 접근의 구체적 법적 근거, 인프라 복사본 삭제 SLA, 수동 권리 요청의 최소 소유 확인 절차는 운영자/전문가의 추가 검토가 필요하다.

## 현재 적용한 안전한 제한

`PRIVACY.md`와 `TERMS.md`를 allowlist `/privacy`, `/terms`로 공개하고 가입 필수 고지/연령 확인·인터넷/팀 별도 공유 선택을 구현했다. 로컬은 가상 정보의 SQLite 볼륨, Azure는 승인된 한국 중부 Table 저장소이며 설정/준비 실패를503으로 표시한다. 소스 저장소에 자격증명·실제 연락처·사용자 프로필을 넣지 않았다.

공개 가입은 영속 저장소와 지정 운영자/문의 설정·별도 flag를 함께 요구한다. 기본 MVP의 최소 수집/선택 공유/삭제·복구·위탁·지원 조건을 작성했으나 법률 자문·준수 인증을 대신하지 않는다. LinkedIn import/AI 등 외부 제공을 활성화하면 실제 처리 조건과 필요한 별도 동의를 먼저 검토해야 한다.
