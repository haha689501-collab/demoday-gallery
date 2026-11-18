// 데모데이 전시관 설정 — 이 파일만 고치면 됩니다.
window.SPACE_CONFIG = {
  title: '데모데이 전시관',
  subtitle: '조별 작품이 걸린 야외 전시 광장을 함께 걸으며 둘러봐요.',

  // 부스 수 (조 수). 통로 양쪽에 번갈아 놓입니다 — 홀수면 왼쪽 줄에 하나 더, 오른쪽 줄은 반 칸 엇갈림.
  booths: 6,

  // 둘러보는 관람객(NPC) 2명 — false 로 두면 없앱니다.
  npcs: true,

  // 대화 · 글자 제한
  maxTextLength: 40,
  bannedWords: [],

  // 한 방 최대 인원 (넘으면 '한적한 전시관으로 가기' 안내)
  roomCapacity: 40,

  // Supabase — 비워 두면 혼자 모드로 동작합니다.
  //   함께 모드: Project URL 과 anon(publishable) 키만 넣으세요. service_role(secret) 키는 절대 넣지 않습니다.
  supabase: {
    url: 'https://ksvpyvitcbmmgtshqmie.supabase.co',
    anonKey: 'sb_publishable_ahNYxvaQ4cMgpmuikwGD-A_3w_nVXf6',
  },
};
