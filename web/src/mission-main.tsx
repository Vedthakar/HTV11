import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MissionApp} from './MissionApp.tsx';
import './mission.css';

createRoot(document.getElementById('root')!).render(<StrictMode><MissionApp /></StrictMode>);
