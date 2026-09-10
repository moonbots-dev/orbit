import type { ComponentProps } from 'react';

// The public landing is one document; its links use normal browser navigation.
export default function Link(props: ComponentProps<'a'>) {
  return <a {...props} />;
}
