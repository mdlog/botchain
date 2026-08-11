import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/* The design system defines its own type scale in index.css (`--text-label`,
   `--text-caption`, …). tailwind-merge only knows Tailwind's stock sizes, so
   it read `text-label` as a *color* utility and dropped whatever real text
   color came before it — `text-on-primary` on a `bg-primary` button, for
   one, which left near-white labels on a light blue fill. Registering the
   scale as font-size puts each utility back in its own conflict group. */
const TEXT_SIZES = [
  'eyebrow',
  'caption',
  'label',
  'body',
  'subtitle',
  'title',
  'display',
  'metric',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TEXT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
