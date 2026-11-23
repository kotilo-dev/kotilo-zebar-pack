import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import './island.css';
import { followTheme } from '../shared/themes';
import { Island } from './Island';

// Before the first render, so the island never shows the default colours first.
followTheme();

createRoot(document.getElementById('root')!).render(<Island />);
