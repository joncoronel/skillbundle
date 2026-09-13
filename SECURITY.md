# Security Policy

## Reporting a vulnerability

Please don't open a public issue for security problems.

Report it privately through GitHub: go to this repository's [Security tab](https://github.com/joncoronel/skillbundle/security) and choose **Report a vulnerability**. If you can't use GitHub, email **support@skillbundle.dev** instead.

Include a description of the issue, the steps to reproduce it, and the impact you think it has. You'll get a reply once I've looked into it, and I'll keep you updated until it's fixed. Please hold off on disclosing it publicly until then.

## Testing against the live app

- Use only accounts you created. Don't access, change, or delete anyone else's data, including their bundles and share links.
- Don't run denial-of-service tests or automated bulk scanning, or do anything else that slows the site down for other people.
- Don't test billing with real payments.
- Once you've confirmed an issue, stop and report it instead of exploring further into real data.

## Scope

- The live app at [skillbundle.dev](https://skillbundle.dev)
- The code in this repository
- How SkillBundle configures the services it uses

Report vulnerabilities in those services themselves (Clerk, Convex, Polar, Vercel, Typesense, Voyage AI, GitHub, skills.sh) to the providers directly.
