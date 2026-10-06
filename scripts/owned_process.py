"""Bounded process ownership for the verification collector and its two shards.

The independent guardian owns a group (POSIX) or kill-on-close Job (Windows).
Only an isolated, stdlib-only bootstrap runs before ownership is established.
Closing the controller pipe, including on abrupt controller death, cancels work.
Private control files belong in the invocation's temporary root, never evidence.
"""
from dataclasses import dataclass
import ctypes
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid


def _write(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf-8')
    temporary.replace(path)


@dataclass(frozen=True)
class ProcessResult:
    returncode: int | None
    cleanup_confirmed: bool
    timed_out: bool
    cancelled: bool
    error: str | None
    receipt: dict

    def as_dict(self):
        return dict(self.receipt, returncode=self.returncode,
                    cleanup_confirmed=self.cleanup_confirmed, timed_out=self.timed_out,
                    cancelled=self.cancelled, error=self.error)


class OwnedProcess:
    """Launch once; poll returns after guardian exit or the absolute deadline.

    All instances must receive the same absolute monotonic stage deadline (less
    any controller reporting reserve). request_cancel is nonblocking so both
    shards can be cancelled before either is waited on. The caller retains the
    temporary root until cleanup_confirmed is true for every launched process.
    A deadline result with guardian_returncode=None explicitly means the guardian
    was not reaped: retain temporary files and do not continue conflicting work.
    """
    def __init__(self, command, *, cwd, env, stdout_path, temp_root, deadline,
                 cleanup_reserve=10.0):
        if not math.isfinite(deadline) or not math.isfinite(cleanup_reserve) or cleanup_reserve <= 0:
            raise ValueError('finite deadline and positive cleanup reserve required')
        if time.monotonic() >= deadline-cleanup_reserve:
            raise TimeoutError('owned process work deadline exhausted before launch')
        self.deadline = deadline
        self.state_dir = Path(tempfile.mkdtemp(prefix='owned-', dir=temp_root))
        self.receipt_path = self.state_dir / 'receipt.json'
        self._token = uuid.uuid4().hex
        self._result = None
        self._cancelled = False
        spec = dict(token=self._token, command=list(command), cwd=str(Path(cwd).resolve()),
                    deadline=deadline, work_deadline=deadline-cleanup_reserve,
                    cleanup_reserve=cleanup_reserve, state_dir=str(self.state_dir))
        spec_path = self.state_dir / 'spec.json'
        _write(spec_path, spec)
        _write(self.receipt_path, dict(token=self._token, complete=False, cleanup_confirmed=False))
        # A real file, not an unread PIPE, also preserves output on cancellation.
        with Path(stdout_path).open('wb') as output:
            self._guardian = subprocess.Popen(
                [sys.executable, '-I', '-S', str(Path(__file__).resolve()), '--guardian', str(spec_path)],
                cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
                close_fds=True, start_new_session=os.name != 'nt',
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)

    @property
    def guardian_pid(self):
        return self._guardian.pid

    def request_cancel(self):
        self._cancelled = True
        if self._guardian.stdin and not self._guardian.stdin.closed:
            self._guardian.stdin.close()

    def poll(self):
        if self._result is not None:
            return self._result
        guardian_exit = self._guardian.poll()
        if guardian_exit is None and time.monotonic() < self.deadline:
            return None
        if guardian_exit is None:
            self.request_cancel()
        elif self._guardian.stdin and not self._guardian.stdin.closed:
            self._guardian.stdin.close()
        try:
            receipt = json.loads(self.receipt_path.read_text(encoding='utf-8'))
            valid = (receipt.get('token') == self._token and receipt.get('complete') is True
                     and guardian_exit == 0)
        except (OSError, ValueError):
            receipt, valid = {}, False
        if not valid:
            receipt = dict(receipt, cleanup_confirmed=False,
                           error='guardian exit/receipt missing or invalid', returncode=None)
        receipt['guardian_returncode'] = guardian_exit
        self._result = ProcessResult(receipt.get('returncode'),
            valid and receipt.get('cleanup_confirmed') is True,
            receipt.get('timed_out', time.monotonic() >= self.deadline),
            receipt.get('cancelled', self._cancelled), receipt.get('error'), receipt)
        return self._result

    def wait(self):
        while True:
            result = self.poll()
            if result is not None:
                return result
            time.sleep(min(.02, max(0, self.deadline-time.monotonic())))

    def cancel(self):
        self.request_cancel()
        return self.wait()


class _PosixTree:
    def __init__(self):
        self.pid = None
        self.subreaper = sys.platform.startswith('linux')
        if self.subreaper:
            # Linux PR_SET_CHILD_SUBREAPER: adopted orphans can be waited on here
            # even when the pytest watchdog exits before its Node descendants.
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(36, 1, 0, 0, 0) != 0:
                raise OSError(ctypes.get_errno(), 'cannot establish child subreaper')

    def assign(self, child):
        if os.getpgid(child.pid) != child.pid:
            raise RuntimeError('bootstrap does not own its process group')
        self.pid = child.pid

    def terminate(self):
        if self.pid is not None:
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def empty(self):
        # Call only after Popen reaped the bootstrap; waitpid(-1) must not steal
        # its status. Linux adoption then lets us reap every orphan descendant.
        if self.subreaper:
            while True:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if pid == 0:
                    return False
        if self.pid is None:
            return True
        try:
            os.killpg(self.pid, 0)
            return False
        except ProcessLookupError:
            return True

    def close(self):
        pass


class _WindowsJob:
    """Win32 declarations follow Microsoft's jobapi2.h / winnt.h contracts.

    https://learn.microsoft.com/windows/win32/procthread/job-objects
    https://learn.microsoft.com/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject
    No breakaway flags: descendants inherit containment, including nested Jobs.
    Unsupported/restricted nesting fails assignment while the bootstrap is gated.
    """
    def __init__(self):
        from ctypes import wintypes as w

        class Limits(ctypes.Structure):
            _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64),
                        ('Flags', w.DWORD), ('MinWorkingSet', ctypes.c_size_t),
                        ('MaxWorkingSet', ctypes.c_size_t), ('ActiveLimit', w.DWORD),
                        ('Affinity', ctypes.c_size_t), ('Priority', w.DWORD), ('Scheduling', w.DWORD)]

        class Extended(ctypes.Structure):
            _fields_ = [('Basic', Limits), ('IO', ctypes.c_uint64 * 6),
                        ('ProcessMemory', ctypes.c_size_t), ('JobMemory', ctypes.c_size_t),
                        ('PeakProcessMemory', ctypes.c_size_t), ('PeakJobMemory', ctypes.c_size_t)]

        class Accounting(ctypes.Structure):
            _fields_ = [('Times', ctypes.c_int64 * 4), ('PageFaults', w.DWORD),
                        ('TotalProcesses', w.DWORD), ('ActiveProcesses', w.DWORD),
                        ('TerminatedProcesses', w.DWORD)]

        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        signatures = {
            'CreateJobObjectW': ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
            'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
            'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
            'QueryInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
            'TerminateJobObject': ([w.HANDLE, w.UINT], w.BOOL),
            'CloseHandle': ([w.HANDLE], w.BOOL),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.api, name)
            function.argtypes, function.restype = args, result
        self.Accounting = Accounting
        self.handle = self.api.CreateJobObjectW(None, None)  # non-inheritable
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        limits.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, child):
        if not self.api.AssignProcessToJobObject(self.handle, int(child._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def terminate(self):
        if not self.api.TerminateJobObject(self.handle, 1):
            raise ctypes.WinError(ctypes.get_last_error())

    def empty(self):
        info = self.Accounting()
        if not self.api.QueryInformationJobObject(self.handle, 1, ctypes.byref(info), ctypes.sizeof(info), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return info.ActiveProcesses == 0

    def close(self):
        if self.handle:
            handle, self.handle = self.handle, None
            if not self.api.CloseHandle(handle):
                raise ctypes.WinError(ctypes.get_last_error())


def _bootstrap(spec):
    # -I -S prevents sitecustomize/user paths importing target code before this
    # one-byte gate. Neither controller nor guardian pipe writers are inherited.
    if os.read(sys.stdin.fileno(), 1) != b'G':
        return 1
    state = Path(spec['state_dir']) / 'command.json'
    if time.monotonic() >= spec['work_deadline']:
        return 1
    try:
        process = subprocess.Popen(spec['command'], cwd=spec['cwd'], stdin=subprocess.DEVNULL,
                                   close_fds=True)
        _write(state, dict(token=spec['token'], pid=process.pid, returncode=None))
        returncode = process.wait()
        _write(state, dict(token=spec['token'], pid=process.pid, returncode=returncode))
        return 0  # Deliberately distinct from the actual command's exit status.
    except OSError as exc:
        _write(state, dict(token=spec['token'], pid=None, returncode=None,
                          error=f'{type(exc).__name__}: {exc}'))
        return 1


@lru_cache(maxsize=1)
def _windows_pipe_probe():
    from ctypes import wintypes as w
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    peek = api.PeekNamedPipe
    peek.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.c_void_p,
                     ctypes.c_void_p, ctypes.c_void_p]
    peek.restype = w.BOOL
    return peek


def _controller_closed():
    if os.name != 'nt':
        import select
        # The controller never writes bytes, so readability means EOF. No
        # background reader can race this final check immediately before gate.
        return bool(select.select([sys.stdin.fileno()], [], [], 0)[0])
    import msvcrt
    # PeekNamedPipe also supports anonymous pipes. Never block a reader on this
    # synchronous handle: that could make a concurrent PeekNamedPipe block.
    if _windows_pipe_probe()(msvcrt.get_osfhandle(sys.stdin.fileno()), None, 0, None, None, None):
        return False
    error = ctypes.get_last_error()
    if error in (109, 232):  # ERROR_BROKEN_PIPE, ERROR_NO_DATA
        return True
    raise ctypes.WinError(error)


def _guardian(spec):
    cancelled = False

    def handle_signal(*_):
        nonlocal cancelled
        cancelled = True

    def is_cancelled():
        nonlocal cancelled
        if _controller_closed():
            cancelled = True
        return cancelled

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, handle_signal)
    receipt = dict(token=spec['token'], complete=False, guardian_pid=os.getpid(),
                   returncode=None, command_pid=None, bootstrap_pid=None,
                   cleanup_confirmed=False, timed_out=False, cancelled=False,
                   error=None, ownership='windows-job' if os.name == 'nt' else 'posix-group')
    tree = child = None
    released = False
    state_dir = Path(spec['state_dir'])
    try:
        tree = _WindowsJob() if os.name == 'nt' else _PosixTree()
        if is_cancelled() or time.monotonic() >= spec['work_deadline']:
            raise RuntimeError('cancelled or deadline exhausted before launch')
        child = subprocess.Popen([sys.executable, '-I', '-S', str(Path(__file__).resolve()),
            '--bootstrap', str(state_dir / 'spec.json')], stdin=subprocess.PIPE,
            close_fds=True, start_new_session=os.name != 'nt')
        receipt['bootstrap_pid'] = child.pid
        tree.assign(child)
        if is_cancelled() or time.monotonic() >= spec['work_deadline']:
            raise RuntimeError('cancelled or deadline exhausted before gate release')
        # Cancellation observed before this gate never runs target code. EOF
        # arriving concurrently with release is detected by the bounded loop.
        child.stdin.write(b'G')
        child.stdin.flush()
        child.stdin.close()
        released = True
        while child.poll() is None and not is_cancelled() and time.monotonic() < spec['work_deadline']:
            time.sleep(.02)
    except Exception as exc:
        receipt['error'] = f'{type(exc).__name__}: {exc}'
    finally:
        receipt['cancelled'] = cancelled
        receipt['timed_out'] = time.monotonic() >= spec['work_deadline']
        cleanup_end = min(spec['deadline']-.1, time.monotonic()+spec['cleanup_reserve']-.1)
        try:
            if child is not None:
                if child.stdin and not child.stdin.closed:
                    child.stdin.close()
                if tree is not None:
                    tree.terminate()
                # If assignment failed, this is still an isolated stdlib-only
                # bootstrap, so killing its PID cannot leave target descendants.
                if not released and child.poll() is None:
                    child.kill()
                while time.monotonic() < cleanup_end:
                    if child.poll() is not None and tree.empty():
                        receipt['cleanup_confirmed'] = True
                        break
                    time.sleep(.01)
            else:
                receipt['cleanup_confirmed'] = True
        except Exception as exc:
            receipt['error'] = f'cleanup: {type(exc).__name__}: {exc}'
        finally:
            if tree is not None:
                try:
                    tree.close()
                except Exception as exc:
                    receipt['cleanup_confirmed'] = False
                    receipt['error'] = f'close: {type(exc).__name__}: {exc}'
        try:
            command = json.loads((state_dir / 'command.json').read_text(encoding='utf-8'))
            if command['token'] != spec['token']:
                raise ValueError('foreign command receipt')
            receipt['command_pid'] = command['pid']
            receipt['returncode'] = command['returncode']
            if command.get('error'):
                receipt['error'] = command['error']
        except (OSError, KeyError, ValueError) as exc:
            receipt['error'] = receipt['error'] or f'command exit unobserved: {exc}'
        receipt['bootstrap_returncode'] = child.poll() if child is not None else None
        if child is not None and receipt['bootstrap_returncode'] != 0 and not (
                receipt['cancelled'] or receipt['timed_out']):
            receipt['error'] = receipt['error'] or 'bootstrap exited without confirming command exit'
        if not receipt['cleanup_confirmed']:
            receipt['error'] = receipt['error'] or 'descendant cleanup not confirmed'
        receipt['complete'] = True
        receipt['finished_monotonic'] = time.monotonic()
        _write(state_dir / 'receipt.json', receipt)
    return 0


if __name__ == '__main__':
    specification = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    raise SystemExit((_guardian if sys.argv[1] == '--guardian' else _bootstrap)(specification))
