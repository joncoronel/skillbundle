import type { MetadataRoute } from "next";

// Web app manifest — drives the install/add-to-home-screen experience and the
// icons Android/Chrome use outside the browser tab. Icons are generated from
// the brand logo by scripts/generate-icons.js. The dark tile matches app/icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SkillBundle",
    short_name: "SkillBundle",
    description:
      "Discover, compare, and bundle AI coding assistant skills for your tech stack",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
