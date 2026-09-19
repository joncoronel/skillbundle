/**
 * What each category means, in the words Jev reads (server-only). Jev reads
 * literally, so most accuracy fixes are a sharper `doesNotCount` naming the
 * near miss. Try a change on a sample before bumping CATEGORIES_VERSION.
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
      "Not backend if it is general coding advice, code review, refactoring or architecture patterns that apply to any code. Not backend if it only calls a third-party service to get a task done for the user (such as sending a message), rather than building software.",
  },
  databases: {
    counts:
      "Designing or working with an application's databases and storage: schemas, queries, SQL, ORMs, migrations of data, sync engines, caches, object or file storage in an application.",
    doesNotCount:
      "Not this if it builds data pipelines or warehouses for analytics; that is Data Engineering. Not this if it only manages files in a consumer drive app or only analyses a dataset.",
  },
  cloud: {
    counts:
      "Provisioning and running infrastructure: cloud providers such as AWS, Azure or GCP, servers and hosting, containers and Docker, Kubernetes and Helm, infrastructure as code such as Terraform, networking, cloud costs and quotas.",
    doesNotCount:
      "Not this if it only sets up CI/CD pipelines, build systems, monorepo tooling or package managers; that is CI/CD & Build Tooling. Not this if it only calls a hosted API such as an AI model.",
  },
  cicd: {
    counts:
      "Building, packaging and shipping code automatically: CI/CD pipelines such as GitHub Actions or GitLab CI, deployment pipelines, build systems, monorepo tooling such as Turborepo or Nx, package managers and dependency management.",
    doesNotCount:
      "Not this if it manages servers, clusters or cloud resources; that is Cloud & Infrastructure. Not this if it only mentions running a build or installing a package as one step of another task.",
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
      "Not this if debugging is only a troubleshooting section in a skill that is mainly about building, setting up or using something else. Not this if it improves code that already works correctly for readability or structure; that is code review or architecture. Not this if it configures a proxy, model provider or tool setup.",
  },
  security: {
    counts:
      "Software or system security: hardening, vulnerability audits, penetration testing techniques, secure configuration, secrets management, security rules, supply chain security.",
    doesNotCount:
      "Not security if the words secure or security appear only as one topic among many, such as one bullet in a list of things a skill covers. Not security if it only adds a login screen.",
  },
  codeReview: {
    counts:
      "Reviewing and improving existing code: giving or receiving code review, refactoring, cleaning up and simplifying code, style guides and lint rules, reducing tech debt.",
    doesNotCount:
      "Not this if it is a guide to one framework's or language's features and best practices; that belongs to that framework's own area, such as Frontend or Backend. Not this if the main goal is fixing a bug, making code faster, or writing tests.",
  },
  architecture: {
    counts:
      "How software is structured across a codebase or system: architecture and design patterns, system design, service boundaries and microservices, domain modeling, clean or hexagonal architecture, error-handling strategy.",
    doesNotCount:
      "Not this if it only lists one framework's conventions or best practices; that belongs to that framework's own area. Not this if it only reviews or tidies code without changing its structure; that is code review.",
  },
  languages: {
    counts:
      "Using a programming language itself, independent of any one framework: its type system, syntax, idioms and concurrency model, for example TypeScript types, Rust async, Go concurrency or modern JavaScript features.",
    doesNotCount:
      "Not this if it is mainly about a framework, library or platform built on the language, such as React, Django, Spring or Flutter; that belongs to that framework's own area.",
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
  dataAnalysis: {
    counts:
      "Analysing and presenting data: exploratory analysis, statistics, charts and data visualization, dashboards and KPIs, product analytics and event tracking, A/B tests and experiments.",
    doesNotCount:
      "Not this if it builds pipelines or warehouses that move data; that is Data Engineering. Not this if it researches markets, competitors or audiences for marketing; that is Marketing & Growth.",
  },
  dataEngineering: {
    counts:
      "Moving and preparing data at scale: data pipelines and ETL, data warehouses and lakes, dbt, Spark, Airflow, streaming, analytical databases such as ClickHouse or Snowflake, data quality checks.",
    doesNotCount:
      "Not this if it only stores data for an application's own features; that is Databases & Storage. Not this if it only analyses or charts data; that is Data Analysis & Visualization.",
  },
  ml: {
    counts:
      "Building machine learning models: training, fine-tuning and evaluating models, feature engineering, MLOps and model deployment, frameworks such as scikit-learn or PyTorch.",
    doesNotCount:
      "Not this if it builds an app on a hosted LLM API with prompts, agents or RAG; that is Building AI Apps & Agents. Not this if it only generates images or video with a model.",
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
      "Attracting and converting customers: advertising, SEO, copywriting, landing page and form conversion, email campaigns, social media posting and strategy, market, competitor and audience research.",
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
