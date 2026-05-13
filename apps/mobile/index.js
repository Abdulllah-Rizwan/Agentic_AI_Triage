// Polyfill Buffer globally before anything else loads.
// React Native's Hermes runtime does not expose Buffer as a global —
// it must be imported from the 'buffer' npm package and wired in manually.
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
