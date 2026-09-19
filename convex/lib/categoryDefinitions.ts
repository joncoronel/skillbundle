/**
 * What each category means, in the words Jev reads. Server-only: the frontend
 * needs labels, not this text (see `categories.ts`).
 *
 * `counts` is what makes a skill belong; `doesNotCount` names the nearby
 * things that don't. Almost every accuracy fix during tuning was a better
 * `doesNotCount` line, because Jev reads literally: "collecting data from
 * websites" caught a skill that only looks up crate versions on docs.rs until
 * the lookup case was excluded by name. Edit these, re-run the sample, and
 * bump CATEGORIES_VERSION if the change should reach already-tagged skills.
 */
import type { CategoryKey } from "./categories";

export const CATEGORY_DEFINITIONS: Record<
  CategoryKey,
  { counts: string; doesNotCount: string }
> = {
  frontend: {
    counts:
      "Building web frontends in code: frontend frameworks like React, Vue, Svelte or Next.js, components and their logic, state management, routing, data fetching in the browser, client-side performance, bundling and build setup for web apps.",
    doesNotCount:
      "Not frontend if it is only about how an interface looks or feels (visual design, design systems, UX, accessibility, animation) with no frontend code; that is UI & Design. Not frontend if it only generates images or videos, or only works on server code.",
  },
  design: {
    counts:
      "How a software interface looks and feels: visual design, layout, typography, color, design systems and tokens, UX and interaction design, accessibility, animation and motion, design review, turning designs into polished UI.",
    doesNotCount:
      "Not this if it only builds frontend logic such as state, routing or data fetching with no attention to how the interface looks. Not this if it designs slides, marketing images, logos or brand strategy rather than a software interface.",
  },
  mobile: {
    counts:
      "Building native or cross-platform apps for phones, tablets, TVs or desktops: iOS, Android, Swift, Kotlin, Jetpack Compose, React Native, Flutter, Electron, app store submission and signing.",
    doesNotCount:
      "Not this if it is a website, or only uses a phone app's API as an end user.",
  },
  backend: {
    counts:
      "Building server-side code: API endpoints, backend frameworks, server logic, authentication and authorization in an app, webhooks, integrating a service's SDK into a backend.",
    doesNotCount:
      "Not backend if it is general coding advice, code review, refactoring or error-handling patterns that apply to any code; those are code quality. Not backend if it only calls a third-party service to get a task done for the user (such as sending a message), rather than building software.",
  },
  databases: {
    counts:
      "Designing or working with databases and data storage: schemas, queries, SQL, ORMs, migrations of data, sync engines, caches, object or file storage in an application.",
    doesNotCount:
      "Not this if it only manages files in a consumer drive app or only analyses a dataset.",
  },
  infra: {
    counts:
      "Deploying and running software: hosting, servers, CI/CD pipelines, containers, Kubernetes, cloud provider resources, networking, build systems, monorepo tooling, cloud costs and quotas.",
    doesNotCount:
      "Not this if it only writes application code, or only runs a hosted AI model through an API.",
  },
  testing: {
    counts:
      "Writing, running or improving automated tests: unit, integration and end-to-end tests, test frameworks, mocks, fixtures, coverage, mutation testing, QA checks.",
    doesNotCount:
      "Not testing if it only debugs a failure without tests, or only reviews code.",
  },
  debugging: {
    counts:
      "Finding and fixing broken or slow software: diagnosing bugs, reading logs, monitoring, error tracking, tracing, observability tools, profiling and performance optimization.",
    doesNotCount:
      "Not this if debugging is only a troubleshooting section in a skill that is mainly about building, setting up or using something else. Not this if it improves code that already works correctly for readability or structure; that is code quality. Not this if it configures a proxy, model provider or tool setup.",
  },
  security: {
    counts:
      "Software or system security: hardening, vulnerability audits, penetration testing techniques, secure configuration, secrets management, security rules, supply chain security.",
    doesNotCount:
      "Not security if the words secure or security appear only as one topic among many, such as one bullet in a list of things a skill covers. Not security if it only adds a login screen.",
  },
  codeQuality: {
    counts:
      "Improving how working code is written and organized: code review, refactoring, architecture, design patterns, style guides, language idioms and best practices, upgrading or migrating code to newer APIs.",
    doesNotCount:
      "Not this if the main goal is fixing a bug, making code faster, or writing tests.",
  },
  gitWorkflow: {
    counts:
      "Source control and the development process around code: commits, branches, pull requests, issues, issue triage, releases, changelogs, versioning.",
    doesNotCount:
      "Not this if it only mentions committing at the end of another task.",
  },
  planning: {
    counts:
      "Deciding what to build before building it: interviewing the user about a plan, brainstorming, writing PRDs, specs or design documents, breaking work into tasks.",
    doesNotCount:
      "Not this if it plans infrastructure capacity or business strategy rather than software work.",
  },
  aiApps: {
    counts:
      "Building your own software that uses AI: LLM APIs and SDKs, agent frameworks, MCP servers, RAG, prompt pipelines, evaluations, embeddings.",
    doesNotCount:
      "Not this if it only changes how the user's coding assistant behaves, or only uses an AI model to make images or video.",
  },
  agentTooling: {
    counts:
      "Changing how the coding assistant itself works: its tone or output style, working habits, memory, session handoffs, context management, or creating, installing and managing agent skills.",
    doesNotCount:
      "Not this if it teaches the assistant a specific technology or task; almost every skill does that.",
  },
  media: {
    counts:
      "Creating, editing or transcribing images, video, audio, speech or avatars: AI generation models, speech to text, rendering video programmatically, or controlling creative apps such as Photoshop or Premiere.",
    doesNotCount:
      "Not this if it only designs a user interface or only makes charts from data.",
  },
  browser: {
    counts:
      "Driving a web browser or collecting data from websites: clicking, filling forms and taking screenshots with tools like Playwright, Puppeteer or the Chrome DevTools Protocol, web scraping and crawling, web or image search APIs, giving the agent web access.",
    doesNotCount:
      "Not this if it only fetches documentation, API references or package information from a website as a lookup step. Not this if it only builds a website, or only writes end-to-end tests for the user's own app; that is testing.",
  },
  data: {
    counts:
      "Working with data: analysis, statistics, charts and data visualization, dashboards, product analytics, data quality, training or evaluating machine learning models.",
    doesNotCount:
      "Not this if it only stores data for an application; that is databases.",
  },
  docs: {
    counts:
      "Writing, translating or converting documents and text: technical documentation, READMEs, guides, specs formatting, converting files between document formats.",
    doesNotCount:
      "Not this if the writing is marketing copy, or the documents are only the input to another task.",
  },
  workplace: {
    counts:
      "Operating everyday work tools on the user's behalf: chat and messaging apps, email, calendars, docs and wiki tools, spreadsheets, task trackers, cloud drives, CRMs; for example Lark/Feishu, Slack, Notion, Google Workspace, Dropbox.",
    doesNotCount:
      "Not this if it builds software that integrates with these tools, or posts marketing content to social media.",
  },
  marketing: {
    counts:
      "Attracting and converting customers: advertising, SEO, copywriting, landing page and form conversion, email campaigns, social media posting and strategy.",
    doesNotCount:
      "Not this if it only builds a website with no marketing goal.",
  },
  finance: {
    counts:
      "Money and running a business: trading, investing, market data, crypto, accounting, invoices, deal and investment documents, business operations, company strategy.",
    doesNotCount:
      "Not this if it manages email, spreadsheets, documents or files that might happen to contain invoices or numbers; the skill itself must be about money, markets or running a business. Not this if it only handles billing code inside an app.",
  },
  science: {
    counts:
      "Scientific, academic or professional research outside software: lab science, biology, chemistry, medicine, academic papers and reproducing research, legal study.",
    doesNotCount:
      "Not this if the research is only about software or a market.",
  },
  gameDev: {
    counts:
      "Building games: game engines such as Unity, Unreal or Godot, game frameworks, game logic and mechanics, sprites and game assets, level design, game rendering.",
    doesNotCount:
      "Not this if it only uses gaming as an example, or builds ordinary interactive web pages.",
  },
};
