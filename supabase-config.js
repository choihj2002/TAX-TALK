// Supabase 연결 설정
// publishable 키는 브라우저에 공개돼도 되는 키예요. (secret 키는 절대 여기에 넣지 마세요.)
window.SUPABASE_CONFIG = {
  url: 'https://kzhuerernwkxromlevuo.supabase.co',
  key: 'sb_publishable_ZQlkZPFBxNu-IR4aOBTg6A_Qv2ZoeqD',
  // 소셜 로그인: Supabase 대시보드 Authentication → Sign In / Providers 에서
  // 해당 제공자를 켜야 버튼이 동작해요. 쓰지 않을 제공자는 false로 바꾸면 버튼이 숨겨져요.
  providers: {
    google: true,
    kakao: true,
  },
  // 관리자 로그인: 로그인 창의 이메일 칸에 id를 적으면 아래 email 계정으로 로그인해요.
  // 비밀번호는 여기 적지 않아요. Supabase 대시보드에서 이 이메일로 사용자를 만들 때 정해요.
  admin: {
    id: 'admin',
    email: 'admin@tax-talk.app',
  },
};
