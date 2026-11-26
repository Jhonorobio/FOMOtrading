#!/usr/bin/env python3
"""
Telegram authentication script using Telethon.
Usage:
  1. Set env vars: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE
     (or put them in .env file)
  2. Run: python auth-telegram.py
  3. Enter the code you receive in Telegram app
  4. Copy the session string printed at the end
  5. Set TELEGRAM_SESSION=<string> in your .env or Railway env vars
"""
import os
import sys

# Load .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            if key not in os.environ:
                os.environ[key] = value

try:
    from telethon.sync import TelegramClient
    from telethon.sessions import StringSession
except ImportError:
    print("ERROR: Telethon not installed. Run: pip install telethon")
    sys.exit(1)

API_ID = os.environ.get('TELEGRAM_API_ID', '')
API_HASH = os.environ.get('TELEGRAM_API_HASH', '')
PHONE = os.environ.get('TELEGRAM_PHONE', '')

if not API_ID or not API_HASH:
    print('ERROR: Set TELEGRAM_API_ID and TELEGRAM_API_HASH env vars first.')
    print('Get them from https://my.telegram.org -> API development tools')
    sys.exit(1)

if not PHONE:
    PHONE = input('Enter your phone number (with country code, e.g. +573107424776): ').strip()
    if not PHONE:
        print('ERROR: Phone number is required.')
        sys.exit(1)

print(f'Connecting to Telegram with phone {PHONE}...')

session = StringSession('')
client = TelegramClient(session, int(API_ID), API_HASH)

client.connect()

if client.is_user_authorized():
    print('Already authorized!')
    print('Session string:')
    print(client.session.save())
    client.disconnect()
    sys.exit(0)

print('Sending code...')
try:
    result = client.send_code_request(PHONE)
    print('Code sent! (check your Telegram app for the code)')
except Exception as e:
    print(f'Failed to send code: {e}')
    client.disconnect()
    sys.exit(1)

code = input('Enter the code you received: ').strip()
if not code:
    print('ERROR: Code is required.')
    client.disconnect()
    sys.exit(1)

password = os.environ.get('TELEGRAM_2FA_PASSWORD', '')
if not password:
    password = input('Enter 2FA password (or leave empty): ').strip()

try:
    client.sign_in(PHONE, code, password=password if password else None)
    print('Signed in successfully!')
except Exception as e:
    print(f'Sign in failed: {e}')
    client.disconnect()
    sys.exit(1)

session_str = client.session.save()
print('\n========================================')
print('SUCCESS! Session string:')
print(session_str)
print('========================================\n')
print('Save this as TELEGRAM_SESSION in your .env or Railway env vars.')

# Save to file
data_dir = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(data_dir, exist_ok=True)
session_path = os.path.join(data_dir, 'telegram-session.txt')
with open(session_path, 'w', encoding='utf-8') as f:
    f.write(session_str)
print(f'Also saved to {session_path}')

client.disconnect()