#!/usr/bin/env python3
"""Quick test script to verify GPS is working and outputting NMEA data."""
import serial
from serial.tools import list_ports
import sys

def find_gps_port():
    """Try to find a USB serial port."""
    ports = list(list_ports.comports())
    for p in ports:
        dev = getattr(p, "device", "") or ""
        if "usbserial" in dev or "usbmodem" in dev:
            return dev
    if ports:
        return getattr(ports[0], "device", None)
    return None

def main():
    port = find_gps_port()
    if not port:
        print("❌ No USB serial ports found. Is the GPS plugged in?")
        print("\nAvailable ports:")
        for p in list_ports.comports():
            print(f"  - {getattr(p, 'device', 'unknown')}")
        return 1
    
    print(f"✅ Found GPS port: {port}")
    print(f"📡 Opening connection at 4800 baud...")
    print("   (Press Ctrl+C to stop)\n")
    
    try:
        with serial.Serial(port, baudrate=4800, timeout=2) as ser:
            line_count = 0
            while line_count < 20:  # Show first 20 NMEA sentences
                line = ser.readline().decode("ascii", errors="replace").strip()
                if line.startswith("$"):
                    line_count += 1
                    print(f"[{line_count:2d}] {line}")
    except KeyboardInterrupt:
        print("\n\n✅ GPS test complete!")
        return 0
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
