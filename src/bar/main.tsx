import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import './bar.css';
import { followTheme } from '../shared/themes';
import { Bar } from './Bar';

// Before the first render, so the bar never shows the default colours first.
followTheme();

createRoot(document.getElementById('root')!).render(<Bar />);
