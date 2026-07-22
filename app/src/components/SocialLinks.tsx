// social / support links (inline SVG icons, theme colour via currentColor)
import type { JSX } from 'solid-js';

const LINKS = {
  coffee: 'https://buymeacoffee.com/utajum',
  github: 'https://github.com/utajum/SynthHUB',
  linkedin: 'https://www.linkedin.com/in/vladdimir',
};

function Icon(props: { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export default function SocialLinks() {
  return (
    <nav class="social flex" aria-label="Support and links">
      <a
        class="social-link coffee"
        href={LINKS.coffee}
        target="_blank"
        rel="noopener noreferrer"
        title="Buy me a coffee"
      >
        <Icon>
          <path d="M4 8h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
          <path d="M17 9h2.5a2.5 2.5 0 0 1 0 5H17" />
          <path d="M7 3c0 1-.8 1.5-.8 2.5S7 7 7 7M11 3c0 1-.8 1.5-.8 2.5S11 7 11 7" />
        </Icon>
        <span>./donate</span>
      </a>

      <a
        class="social-link"
        href={LINKS.github}
        target="_blank"
        rel="noopener noreferrer"
        title="Source on GitHub"
      >
        <Icon>
          <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
        </Icon>
        <span>./src</span>
      </a>

      <a
        class="social-link"
        href={LINKS.linkedin}
        target="_blank"
        rel="noopener noreferrer"
        title="LinkedIn"
      >
        <Icon>
          <path d="M16 8a6 6 0 0 1 6 6v6h-4v-6a2 2 0 0 0-4 0v6h-4v-10h4v1.5" />
          <rect x="2" y="9" width="4" height="11" />
          <circle cx="4" cy="4" r="2" />
        </Icon>
        <span>./connect</span>
      </a>
    </nav>
  );
}
