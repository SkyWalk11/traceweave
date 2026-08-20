<?php

// Entry point for `-d auto_prepend_file=`. TTD_PROJECT_ROOT/TTD_SERVICE_NAME/
// TTD_API_URL are injected by the debugger backend the same way NODE_OPTIONS
// is for Node projects (see backend/src/processes.ts).

require __DIR__ . '/vendor/autoload.php';

\TtdCapture\StreamWrapper::register(getenv('TTD_PROJECT_ROOT') ?: getcwd());
