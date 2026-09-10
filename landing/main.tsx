import { hydrateRoot } from 'react-dom/client';
import Landing from '../app/play/landing';
import '../app/globals.css';
import './public.css';

hydrateRoot(document.getElementById('root')!, <Landing publicSite />);
