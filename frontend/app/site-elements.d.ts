// site-shell's custom elements (akshayDev17/site-themes, shell/).
//   <site-slot>: filled at the edge from the site's app list; what the app renders inside
//   it is the fallback.
//   <site-theme-picker>: the shared theme picker, defined by /_site/<build>/site.js.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'site-slot': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        name: 'site-path' | 'site-apps';
        /** site-path only: the app's crumbs after its name, as JSON [{ label, href? }]. */
        'data-tail'?: string;
      };
      'site-theme-picker': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        'hide-label'?: '';
        label?: string;
      };
    }
  }
}
