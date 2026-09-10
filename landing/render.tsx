import { renderToString } from 'react-dom/server';
import Landing from '../app/play/landing';

export function render() {
  return renderToString(<Landing publicSite />);
}
