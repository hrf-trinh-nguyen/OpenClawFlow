import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Pipeline skills (apollo → bouncer → instantly)
    'skills/apollo/index':      'skills/apollo/index.ts',
    'skills/bouncer/index':    'skills/bouncer/index.ts',
    'skills/instantly/index':  'skills/instantly/index.ts',
    // Reporting
    'skills/report-build/index':   'skills/report-build/index.ts',
    'skills/slack-notify/index':   'skills/slack-notify/index.ts',
    // Lead management
    'skills/lead-stats/index':     'skills/lead-stats/index.ts',
    'skills/lead-move/index':      'skills/lead-move/index.ts',
    'skills/lead-delete/index':    'skills/lead-delete/index.ts',
    // Shared libraries
    'lib/supabase-pipeline': 'lib/supabase-pipeline.ts',
    'lib/supabase-legacy':   'lib/supabase-legacy.ts',
    // Scripts
    'scripts/monthly-report': 'scripts/monthly-report.ts',
  },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  outDir: '.',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: false,
});
