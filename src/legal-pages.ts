const EFFECTIVE_DATE = "August 27, 2026";
const PROJECT_URL = "https://github.com/basedappsandgames/what-beats-learning";

const styles = `
  :root { color-scheme: light; }
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; background: #f4efe6; color: #1f1a14; }
  main { max-width: 48rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
  h1 { font-size: 2.1rem; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
  h2 { font-size: 1.35rem; margin-top: 2rem; }
  p, li { line-height: 1.6; }
  .updated, footer { color: #6b5e50; }
  a { color: #8a2f12; }
  footer { border-top: 1px solid #d8cbb9; margin-top: 3rem; padding-top: 1rem; font-size: 0.9rem; }
`;

function page(title: string, content: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — What Beats Learning</title>
  <style>${styles}</style>
</head>
<body>
  <main>
    ${content}
    <footer>
      <a href="/">What Beats Learning</a> ·
      <a href="/docs/privacy">Privacy</a> ·
      <a href="/docs/terms">Terms</a>
    </footer>
  </main>
</body>
</html>`;
}

export function privacyPolicyPage(): string {
	return page(
		"Privacy Policy",
		`<h1>Privacy Policy</h1>
<p class="updated">Effective ${EFFECTIVE_DATE}</p>
<p>This policy explains how What Beats Learning (“we,” “us,” or the “Service”) handles information when you use its website and remote Model Context Protocol (MCP) tutoring service.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Google account information.</strong> When you sign in with Google, we receive your Google account identifier, name, and email address. We do not receive or store your Google password.</li>
  <li><strong>Learning content.</strong> We store the decks, cards, tags, prompts, review history, scheduling data, and generated audio that you or your connected AI agent create through the Service. Text submitted for speech is sent to our speech provider and stored with the resulting clip in a shared content-addressed cache, so identical requests can reuse one clip.</li>
  <li><strong>Authorization data.</strong> We process OAuth tokens, client approvals, and strictly necessary cookies so that you can sign in and connect an MCP client.</li>
  <li><strong>Operational data.</strong> Our infrastructure provider may process request metadata such as IP address, user agent, timestamps, and error or security logs to deliver and protect the Service.</li>
</ul>
<p>We do not collect payment information, address-book contacts, precise location, or advertising profiles. We do not use advertising or analytics trackers.</p>

<h2>How we use information</h2>
<p>We use this information only to authenticate you, keep each user’s learning library isolated, provide spaced-repetition and tutoring features, maintain security, diagnose failures, and comply with law.</p>

<h2>Your AI agent and MCP client</h2>
<p>The Service is designed to be used through an MCP client and AI agent that you authorize. Tool responses are returned to that client and agent. In particular, the <code>whoami</code> tool currently returns your name, email address, Google account identifier, and library counts. Other tools return or modify your learning content as needed to tutor you. Your MCP client, AI provider, or agent may process and retain this information under its own terms and privacy policy. Only connect clients and agents you trust.</p>

<h2>How we disclose information</h2>
<p>We do not sell personal information, share it for cross-context behavioral advertising, or rent it to others. We disclose information only:</p>
<ul>
  <li>to Google for sign-in;</li>
  <li>to Cloudflare, which hosts the Service and its storage;</li>
  <li>to MiniMax or Fish Audio when you ask the Service to generate speech;</li>
  <li>to the MCP client and AI agent you authorize, as described above;</li>
  <li>when required by law or reasonably necessary to protect users, the Service, or others; or</li>
  <li>in connection with a merger, acquisition, financing, or transfer of the Service, subject to this policy or notice of a replacement policy.</li>
</ul>

<h2>Cookies</h2>
<p>We use only cookies needed for OAuth security, session binding, and remembering an approved MCP client. We do not use cookies for advertising or behavioral tracking.</p>

<h2>Retention and deletion</h2>
<p>We retain account and learning data while your library remains in the Service, and retain limited operational records as reasonably needed for security, debugging, legal compliance, and backups. You may request access, correction, or deletion through the project contact below. Deleting data from the Service does not delete copies already sent to an MCP client or AI provider; contact those providers separately.</p>

<h2>Security</h2>
<p>Each Google account is assigned an isolated storage object, and access requires OAuth authorization. No system is completely secure, so we cannot guarantee that information will never be lost or accessed improperly.</p>

<h2>Children</h2>
<p>The Service is not directed to children under 13, and we do not knowingly collect their personal information. If you believe a child under 13 has provided information, contact us so we can delete it.</p>

<h2>Your privacy rights</h2>
<p>Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of your personal information, or to appeal a denied request. We do not discriminate against anyone for exercising a privacy right. Submit a request through the contact below; we may need to verify that the request relates to your account.</p>

<h2>Changes to this policy</h2>
<p>We may update this policy as the Service changes. We will post the revised policy here and update its effective date. Material changes apply prospectively.</p>

<h2>Contact</h2>
<p>For questions or privacy requests, contact the operator through the <a href="${PROJECT_URL}">What Beats Learning project repository</a>. Do not include passwords, access tokens, or sensitive learning content in a public issue.</p>`,
	);
}

export function termsOfServicePage(): string {
	return page(
		"Terms of Service",
		`<h1>Terms of Service</h1>
<p class="updated">Effective ${EFFECTIVE_DATE}</p>
<p>These Terms govern your use of the What Beats Learning website and remote MCP tutoring service (the “Service”). By accessing or using the Service, you agree to these Terms. If you do not agree, do not use the Service.</p>

<h2>1. Eligibility and accounts</h2>
<p>You must be at least 13 years old and legally able to agree to these Terms. If you are under the age of majority where you live, a parent or guardian must permit your use. You sign in through Google and are responsible for activity by MCP clients and AI agents you authorize. Notify us if you believe your account or authorization has been compromised.</p>

<h2>2. The Service</h2>
<p>Subject to these Terms, we grant you a limited, personal, non-exclusive, non-transferable, revocable right to use the Service. We may change, suspend, or discontinue any part of the Service at any time. The Service is provided without a support or availability commitment.</p>

<h2>3. Acceptable use</h2>
<p>You may not use the Service to violate law or another person’s rights; introduce malware; gain unauthorized access; interfere with operation or security; evade usage limits; probe other users’ data; impersonate another person; or use automated traffic in a way that burdens the Service. You may not resell access without our written permission.</p>

<h2>4. Your content and connected agents</h2>
<p>You retain ownership of learning content you submit. You give us a worldwide, non-exclusive, royalty-free license to host, copy, process, and transmit that content only as needed to operate, secure, and improve the Service. You represent that you have the rights needed to submit it.</p>
<p>The MCP clients, AI agents, and AI providers you connect are third-party services under your control. They can receive account information and learning content through tools and can create, change, or review your library. You are responsible for choosing and authorizing them. Their own terms and privacy policies apply.</p>

<h2>5. Learning and AI disclaimer</h2>
<p>AI-generated tutoring, grading, card content, and scheduling may be incomplete, inaccurate, or inappropriate. The Service does not guarantee any educational result and is not a substitute for qualified professional advice. Review important outputs and do not rely on the Service for medical, legal, financial, safety-critical, or other professional decisions.</p>

<h2>6. Privacy</h2>
<p>Our <a href="/docs/privacy">Privacy Policy</a> explains how we handle information and is incorporated into these Terms.</p>

<h2>7. Third-party services</h2>
<p>The Service relies on or may link to third-party services, including Google, Cloudflare, MCP clients, and AI providers. We do not control and are not responsible for third-party services, content, availability, or practices. Your use of them is governed by their terms.</p>

<h2>8. Intellectual property and feedback</h2>
<p>Except for your content and third-party materials, the Service and its software, design, and content are owned by or licensed to us. If you provide feedback, you grant us a perpetual, irrevocable, worldwide, royalty-free right to use it without restriction or compensation.</p>

<h2>9. Suspension and termination</h2>
<p>You may stop using the Service at any time. We may suspend or terminate access if you violate these Terms, create risk or legal exposure, or threaten the Service or its users. Sections that by their nature should survive termination will survive, including ownership, disclaimers, liability limits, and general terms.</p>

<h2>10. Disclaimers</h2>
<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, SECURITY, OR UNINTERRUPTED AVAILABILITY.</p>

<h2>11. Limitation of liability</h2>
<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR SUPPLIERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST DATA, PROFITS, REVENUE, OR OPPORTUNITIES, ARISING FROM THE SERVICE OR THESE TERMS. OUR TOTAL LIABILITY FOR ALL CLAIMS WILL NOT EXCEED THE GREATER OF US$50 OR THE AMOUNT YOU PAID TO USE THE SERVICE IN THE SIX MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO THEY APPLY ONLY TO THE EXTENT PERMITTED.</p>

<h2>12. Changes</h2>
<p>We may update these Terms by posting a revised version and changing the effective date. Material changes apply prospectively. Your continued use after the revised Terms take effect means you accept them.</p>

<h2>13. General terms</h2>
<p>If any provision is unenforceable, it will be modified only as much as necessary and the remaining provisions will continue in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent; we may assign them with the Service. These Terms and the Privacy Policy are the entire agreement about the Service.</p>

<h2>14. Contact</h2>
<p>Questions about these Terms may be submitted through the <a href="${PROJECT_URL}">What Beats Learning project repository</a>. Do not include passwords or access tokens in a public issue.</p>`,
	);
}
