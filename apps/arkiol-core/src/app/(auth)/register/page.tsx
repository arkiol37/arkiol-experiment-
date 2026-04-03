// src/app/(auth)/register/page.tsx
// Server component wrapper — reads Google OAuth config server-side.
import { RegisterForm } from "./RegisterForm";

export default function RegisterPage() {
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
  return <RegisterForm googleEnabled={googleEnabled} />;
}
