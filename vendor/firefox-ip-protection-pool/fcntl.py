"""Minimal Windows compatibility shim for the subset of fcntl.flock used by
firefox-ip-protection-pool.

This file is installed only on Windows.  It implements advisory exclusive file
locking with the Microsoft CRT locking primitive so the upstream Linux-oriented
refresh lock can keep its existing API.
"""
from __future__ import annotations

import errno
import os
import time
import msvcrt

LOCK_SH = 1
LOCK_EX = 2
LOCK_NB = 4
LOCK_UN = 8


def _seek_zero(fd: int) -> int:
    old = os.lseek(fd, 0, os.SEEK_CUR)
    os.lseek(fd, 0, os.SEEK_SET)
    return old


def _ensure_lock_byte(fd: int) -> None:
    try:
        if os.fstat(fd).st_size < 1:
            os.lseek(fd, 0, os.SEEK_END)
            os.write(fd, b"\0")
            try:
                os.fsync(fd)
            except OSError:
                pass
    finally:
        os.lseek(fd, 0, os.SEEK_SET)


def flock(fd: int, operation: int) -> None:
    """Implement the flock operations used by refresh_state.py.

    Shared locks are treated as exclusive because the upstream project only
    requests exclusive locks.  LOCK_NB raises BlockingIOError when busy.
    """
    old = _seek_zero(fd)
    try:
        _ensure_lock_byte(fd)
        if operation & LOCK_UN:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            return

        nonblocking = bool(operation & LOCK_NB)
        while True:
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                return
            except OSError as exc:
                if nonblocking:
                    raise BlockingIOError(errno.EWOULDBLOCK, "file lock is busy") from exc
                time.sleep(0.05)
    finally:
        try:
            os.lseek(fd, old, os.SEEK_SET)
        except OSError:
            pass
