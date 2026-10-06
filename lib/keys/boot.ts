import "server-only";
import { startKeySync } from "./store";

/* Imported by every client of an outside service: the keys saved on 渠道与凭据 reach this process at start and every 30 seconds after. */
startKeySync();
