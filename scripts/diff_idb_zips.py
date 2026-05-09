"""Compare morning IDB zip vs evening IDB zip — list changed/new/removed FGBs."""
import os, hashlib, sys

def inv(root):
    out = {}
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.lower().endswith('.fgb'):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            with open(p, 'rb') as fh:
                h = hashlib.sha256(fh.read()).hexdigest()
            out[rel] = (os.path.getsize(p), h)
    return out


a = inv('_tmp_idb_zip/Irish Digitised Boundaries')
b = inv('_tmp_idb_zip2/Irish Digitised Boundaries')

new_in_b = sorted(set(b) - set(a))
removed = sorted(set(a) - set(b))
changed = sorted([k for k in a if k in b and a[k] != b[k]])

print(f'== Compared {len(a)} files (morning zip) vs {len(b)} files (evening zip) ==')
print(f'\nNEW in evening zip ({len(new_in_b)}):')
for k in new_in_b: print('  +', k)
print(f'\nREMOVED from evening zip ({len(removed)}):')
for k in removed: print('  -', k)
print(f'\nCHANGED bytes between zips ({len(changed)}):')
for k in changed:
    print(f'  ~ {k}: {a[k][0]}->{b[k][0]} bytes  sha {a[k][1][:8]}..->{b[k][1][:8]}..')
