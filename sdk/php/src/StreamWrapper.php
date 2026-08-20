<?php

namespace TtdCapture;

// Registering 'file' globally intercepts every fopen-family call in the
// process, not just include/require — Monolog opening its log file for
// writing, config files being read, etc. all route through here too. Only
// the read-and-instrument case (a project .php file being require'd) needs
// the in-memory transformed-buffer path; everything else — writes, appends,
// non-php files, vendor/ files — is proxied straight through to a real file
// handle so the wrapper is otherwise invisible.
final class StreamWrapper
{
    public $context;

    private ?string $buffer = null;
    private int $position = 0;

    /** @var resource|null */
    private $handle = null;

    /** @var resource|null */
    private $dirHandle = null;

    private static string $projectRoot = '';

    public static function register(string $projectRoot): void
    {
        self::$projectRoot = rtrim(realpath($projectRoot) ?: $projectRoot, '/');
        stream_wrapper_unregister('file');
        stream_wrapper_register('file', self::class);
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        $baseMode = str_replace(['b', 't'], '', $mode);
        $isRead = str_starts_with($baseMode, 'r') && !str_contains($baseMode, '+');

        if ($isRead && $this->shouldInstrument($path)) {
            $real = self::withRealWrapper(fn () => file_get_contents($path));
            if ($real === false) return false;
            $this->buffer = self::withRealWrapper(function () use ($real, $path) {
                try {
                    return Instrumentor::transform($real, $path);
                } catch (\Throwable) {
                    return $real; // never let a parse/transform failure break the host app's require
                }
            });
            $this->position = 0;
            return true;
        }

        $this->handle = self::withRealWrapper(fn () => fopen($path, $mode, (bool) ($options & STREAM_USE_PATH)));
        return $this->handle !== false;
    }

    private function shouldInstrument(string $path): bool
    {
        $resolved = realpath($path) ?: $path;
        if (!str_starts_with($resolved, self::$projectRoot . '/')) return false;
        if (str_contains($resolved, '/vendor/')) return false;
        return str_ends_with($resolved, '.php');
    }

    // Reading the real file, or running the parser (which itself does
    // filesystem I/O for its own files), through this same overridden 'file'
    // wrapper recurses into stream_open() again — PHP throws "infinite
    // recursion prevented". The documented fix: temporarily restore the
    // built-in wrapper around any such call, then re-register ours after.
    private static function withRealWrapper(callable $fn): mixed
    {
        stream_wrapper_restore('file');
        try {
            return $fn();
        } finally {
            stream_wrapper_unregister('file');
            stream_wrapper_register('file', self::class);
        }
    }

    public function stream_read(int $count): string|false
    {
        if ($this->buffer !== null) {
            $chunk = substr($this->buffer, $this->position, $count);
            $this->position += strlen($chunk);
            return $chunk;
        }
        return self::withRealWrapper(fn () => fread($this->handle, $count));
    }

    public function stream_write(string $data): int|false
    {
        return self::withRealWrapper(fn () => fwrite($this->handle, $data));
    }

    public function stream_eof(): bool
    {
        if ($this->buffer !== null) return $this->position >= strlen($this->buffer);
        return self::withRealWrapper(fn () => feof($this->handle));
    }

    public function stream_seek(int $offset, int $whence = SEEK_SET): bool
    {
        if ($this->buffer !== null) {
            $base = match ($whence) {
                SEEK_CUR => $this->position,
                SEEK_END => strlen($this->buffer),
                default => 0,
            };
            $new = $base + $offset;
            if ($new < 0 || $new > strlen($this->buffer)) return false;
            $this->position = $new;
            return true;
        }
        return self::withRealWrapper(fn () => fseek($this->handle, $offset, $whence) === 0);
    }

    public function stream_tell(): int
    {
        if ($this->buffer !== null) return $this->position;
        return self::withRealWrapper(fn () => ftell($this->handle));
    }

    public function stream_flush(): bool
    {
        if ($this->handle === null) return true;
        return self::withRealWrapper(fn () => fflush($this->handle));
    }

    public function stream_close(): void
    {
        if ($this->handle !== null) {
            self::withRealWrapper(fn () => fclose($this->handle));
        }
    }

    public function stream_lock(int $operation): bool
    {
        if ($this->handle === null) return true;
        return self::withRealWrapper(fn () => flock($this->handle, $operation));
    }

    public function stream_stat(): array
    {
        if ($this->buffer !== null) return ['size' => strlen($this->buffer)];
        return self::withRealWrapper(fn () => fstat($this->handle)) ?: [];
    }

    public function stream_set_option(int $option, int $arg1, ?int $arg2): bool
    {
        return true; // no-op — PHP's include machinery calls this and warns if the wrapper lacks it
    }

    public function url_stat(string $path, int $flags): array|false
    {
        return self::withRealWrapper(fn () => @stat($path));
    }

    public function unlink(string $path): bool
    {
        return self::withRealWrapper(fn () => unlink($path));
    }

    public function rename(string $from, string $to): bool
    {
        return self::withRealWrapper(fn () => rename($from, $to));
    }

    public function mkdir(string $path, int $mode, int $options): bool
    {
        return self::withRealWrapper(fn () => mkdir($path, $mode, (bool) ($options & STREAM_MKDIR_RECURSIVE)));
    }

    public function rmdir(string $path): bool
    {
        return self::withRealWrapper(fn () => rmdir($path));
    }

    // RecursiveDirectoryIterator (config/route/view discovery all over
    // Laravel's boot process) opens directories through the same 'file'
    // wrapper — proxy to a real directory handle, same pattern as writes.
    public function dir_opendir(string $path, int $options): bool
    {
        $this->dirHandle = self::withRealWrapper(fn () => opendir($path));
        return $this->dirHandle !== false;
    }

    public function dir_readdir(): string|false
    {
        return self::withRealWrapper(fn () => readdir($this->dirHandle));
    }

    public function dir_rewinddir(): bool
    {
        self::withRealWrapper(fn () => rewinddir($this->dirHandle));
        return true;
    }

    public function dir_closedir(): bool
    {
        if ($this->dirHandle !== null) {
            self::withRealWrapper(fn () => closedir($this->dirHandle));
        }
        return true;
    }
}
