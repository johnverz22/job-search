import type { Connector, Platform } from '../types.js';
import { bamboohr } from './bamboohr.js';
import { personio } from './personio.js';
import { recruitee } from './recruitee.js';
import { rippling } from './rippling.js';
import { teamtailor } from './teamtailor.js';

export const connectors: Record<Platform, Connector> = { recruitee, personio, teamtailor, rippling, bamboohr };
