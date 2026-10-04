#!/usr/bin/env python3
"""Compatibility entry point for the catalogue-wide frequency refresh."""
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('global_service_frequency',Path(__file__).with_name('global-service-frequency.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
if __name__=='__main__':module.main()
