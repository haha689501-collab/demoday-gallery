// 데모데이 전시관 — 배포용 (학생 이름 없음)
//
// ⚠️ 배포하면 누구나 이 파일을 열어 볼 수 있습니다. 학생 이름은 넣지 않습니다.
//    이름이 있는 판은 teams.local.js (반 안에서 zip 으로만, 배포에서 빠짐)
//
// - no: 부스 번호   team: 조 이름   title: 작품 제목   url: 작품 주소 (https://)   thumb: 액자 캡처 (works/ 안)
// - 2조 · 4조는 캡처만 걸려 있음 (작품 복사본은 공개하지 않음) — 학생이 직접 배포한 주소를 받으면 url 을 채우면 '작품 열기'가 생김
window.GALLERY_TEAMS = [
  { no: 1, team: '1조', title: '별담 유리병', url: 'https://claude.ai/artifact/MiwJVpmhTziF2DvUymPUyY#jar-3Q2YHC', thumb: 'works/byeoldam.jpg' },
  { no: 2, team: '2조', title: '쓸모없는 사이트 A–Z', url: '', thumb: 'works/useless-az.jpg' },
  { no: 3, team: '3조', title: '드래프트 룸', url: 'https://jiddaeng.github.io/brawl/', thumb: 'works/draft-room.jpg' },
  { no: 4, team: '4조', title: 'Aro — 디자인 시안', url: '', thumb: 'works/aro.jpg' },
  { no: 5, team: '5조', title: '', url: '', thumb: '' },
  { no: 6, team: '6조', title: '', url: '', thumb: '' },
];

// 좋아요 회차 — 숫자를 1 올려 올리면(커밋 · 푸시) 모든 좋아요가 0 부터 다시 시작 (예전 숫자는 Supabase 에 남지만 안 씀)
window.GALLERY_LIKES_ROUND = 1;
