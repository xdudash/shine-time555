-- Stage 1, fix 13: remove the settings nothing reads.
--
-- These keys were editable in admin → Settings while no code read them, so
-- changing them did nothing and reading them misled whoever looked:
--   windowEnd, rescueStart        superseded by the per-property deadline and by
--                                 rescueHours (stage 1 dispatch)
--   sameZoneTravelBuffer          never applied; travelBuffer is the only buffer used
--   surge2Start/4Start/6Start     from an abandoned surge-pricing idea
--   clientCancellationCutoffHours client cancellation is free until the cleaner
--                                 arrives (owner decision 8 of 2026-10-12)
--   clientBookingStepMinutes      fixed-slot booking was replaced by window booking
--   defaultLanguage               every account carries its own language
--
-- Nothing else referenced them: the keys are gone from settings() in st-api and
-- from the settings form in the same commit, and tests/settings-contract.test.mjs
-- fails if a key is ever shown or stored without a reader again.
delete from public.st_settings where setting_key in (
  'windowEnd','rescueStart','sameZoneTravelBuffer',
  'surge2Start','surge4Start','surge6Start',
  'clientCancellationCutoffHours','clientBookingStepMinutes','defaultLanguage'
);
