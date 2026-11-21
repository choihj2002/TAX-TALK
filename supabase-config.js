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
};
