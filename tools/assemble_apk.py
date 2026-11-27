#!/usr/bin/env python3
"""Assemble the single-file index.html from src/ sources (runs in CI inside build.sh)."""
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root
shell = open(os.path.join(root, 'src', 'shell.html'), encoding='utf-8').read()
engine = open(os.path.join(root, 'src', 'engine.js'), encoding='utf-8').read().strip()
ui = open(os.path.join(root, 'src', 'ui.js'), encoding='utf-8').read().strip()

assert shell.count('/*@@ENGINE@@*/') == 1, 'engine placeholder missing'
assert shell.count('/*@@UI@@*/') == 1, 'ui placeholder missing'
assert '/*@@' not in engine and '/*@@' not in ui

html = shell.replace('/*@@ENGINE@@*/', engine).replace('/*@@UI@@*/', ui)

with open(os.path.join(root, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(html)
print('index.html assembled:', len(html), 'bytes')
