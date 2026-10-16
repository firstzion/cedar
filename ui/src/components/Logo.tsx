/** The ATS logo (white on transparent, so it belongs on the navy top bar or sign-in backdrop). */
export function Logo({ className = 'logo' }: { className?: string }) {
  return <img className={className} src={`${import.meta.env.BASE_URL}brand/ats-logo-reverse.png`} alt="ATS" width={88} height={44} />
}
