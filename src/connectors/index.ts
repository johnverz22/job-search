import type { Connector, Platform } from '../types.js';
import { bamboohr } from './bamboohr.js';
import { gem } from './gem.js';
import { icims, jazzhr, jobvite, yc } from './htmlJsonLd.js';
import { personio } from './personio.js';
import { pinpoint } from './pinpoint.js';
import { recruitee } from './recruitee.js';
import { rippling } from './rippling.js';
import { taleo } from './taleo.js';
import { teamtailor } from './teamtailor.js';
import { workday } from './workday.js';

export const connectors: Record<Platform, Connector> = {
  recruitee, personio, teamtailor, rippling, bamboohr, gem, pinpoint, jazzhr, jobvite, icims, taleo, workday, yc,
};
