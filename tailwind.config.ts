import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        navy: { 50: "#E8F1FB", 600: "#234876", 700: "#1B365D", 800: "#15294A", 900: "#152A47" },
        brand: { DEFAULT: "var(--mx-accent)", 50: "#E8F1FB", rail: "#4A90D9", link: "#2563EB" },
        sidebar: { DEFAULT: "#1B365D", top: "#15294A", idle: "#9DB2CE", sub: "#7E98BE" },
        success: { DEFAULT: "var(--mx-good)", bg: "var(--mx-tint-green)" },
        danger: { DEFAULT: "#C2410C", bg: "#FBEDE6" },
        warn: { DEFAULT: "var(--mx-warn)", bg: "var(--mx-tint-amber)" },
        info: { DEFAULT: "var(--mx-info)", bg: "var(--mx-tint-indigo)" },
        ink: {
          DEFAULT: "var(--mx-text)",
          soft: "var(--mx-text-strong)",
          2: "var(--mx-text-2)",
          3: "var(--mx-text-3)",
          muted: "var(--mx-muted)",
          muted2: "var(--mx-muted-2)",
          muted3: "var(--mx-muted-3)",
        },
        line: { DEFAULT: "var(--mx-border)", soft: "var(--mx-border-soft)", top: "var(--mx-border-soft)" },
        surface: { DEFAULT: "var(--mx-surface)", app: "var(--mx-bg)", input: "var(--mx-surface-2)", 3: "var(--mx-surface-3)" },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: { "accordion-down": "accordion-down 0.2s ease-out", "accordion-up": "accordion-up 0.2s ease-out" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
