/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {
    colors: {
      brand: { DEFAULT: "var(--brand-primary)", hover: "var(--brand-hover)", pressed: "var(--brand-pressed)", soft: "var(--brand-soft)" },
      page: "var(--bg-page)", surface: "var(--bg-surface)", sidebar: "var(--bg-sidebar)", hover: "var(--bg-hover)", column: "var(--bg-column)", track: "var(--bg-track)", overlay: "var(--bg-overlay)",
      heading: "var(--text-heading)", secondary: "var(--text-secondary)", muted: "var(--text-muted)", danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" }, success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" }, warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
      line: "var(--border-default)", strong: "var(--border-strong)"
    },
    fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    borderRadius: { sm: "6px", DEFAULT: "8px", lg: "12px", xl: "16px" }
  }},
  plugins: []
};
