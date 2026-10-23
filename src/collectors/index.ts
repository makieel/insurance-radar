import type { Collector } from './types.ts';
import { fscPress, fscRule } from './fsc.ts';
import { fssPress, fssAlert } from './fss.ts';
import { kniaPress, kniaRates } from './knia.ts';
import { kliaPress } from './klia.ts';
import { kiri } from './kiri.ts';
import { hanwha, kyobo, samsungfire, meritz } from './insurers.ts';
import { insnews, insweek, insjournal, fins } from './press.ts';
import { naver } from './naver.ts';

export const COLLECTORS: Collector[] = [
  fscPress, fscRule, fssPress, fssAlert,
  kniaPress, kniaRates, kliaPress, kiri,
  hanwha, kyobo, samsungfire, meritz,
  insnews, insweek, insjournal, fins, naver,
];
