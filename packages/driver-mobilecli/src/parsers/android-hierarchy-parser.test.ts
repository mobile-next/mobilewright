import { test, expect } from '@playwright/test';
import { parseAndroidHierarchy } from './android-hierarchy-parser.js';

const SAMPLE_ANDROID_XML = `
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" visible-to-user="true" bounds="[0,0][1080,1920]">
    <node index="0" text="" resource-id="com.example.app:id/toolbar" class="android.widget.Toolbar" package="com.example.app" content-desc="Login" enabled="true" visible-to-user="true" bounds="[0,50][1080,150]">
      <node index="0" text="Login" resource-id="" class="android.widget.TextView" package="com.example.app" content-desc="" enabled="true" visible-to-user="true" bounds="[40,60][200,140]"/>
    </node>
    <node index="1" text="" resource-id="com.example.app:id/email_input" class="android.widget.EditText" package="com.example.app" content-desc="Email" enabled="true" visible-to-user="true" focused="false" bounds="[20,200][1060,280]" hint="Enter email"/>
    <node index="2" text="" resource-id="com.example.app:id/password_input" class="android.widget.EditText" package="com.example.app" content-desc="Password" enabled="true" visible-to-user="true" bounds="[20,300][1060,380]"/>
    <node index="3" text="Sign In" resource-id="com.example.app:id/login_btn" class="android.widget.Button" package="com.example.app" content-desc="" enabled="true" visible-to-user="true" bounds="[20,420][1060,500]"/>
    <node index="4" text="Forgot Password?" resource-id="com.example.app:id/forgot_link" class="android.widget.TextView" package="com.example.app" content-desc="" enabled="true" visible-to-user="false" bounds="[20,520][1060,570]"/>
    <node index="5" text="" resource-id="com.example.app:id/remember_switch" class="android.widget.Switch" package="com.example.app" content-desc="Remember Me" enabled="true" visible-to-user="true" selected="false" bounds="[20,600][100,660]"/>
  </node>
</hierarchy>`;

test.describe('parseAndroidHierarchy', () => {
  test('parses root element correctly', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('FrameLayout');
  });

  test('builds correct tree structure', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];
    expect(root.children).toHaveLength(6); // Toolbar + 2 EditText + Button + TextView + Switch
  });

  test('shortens class names to simple type', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];
    const types = root.children.map((c) => c.type);
    expect(types).toEqual([
      'Toolbar',
      'EditText',
      'EditText',
      'Button',
      'TextView',
      'Switch',
    ]);
  });

  test('parses Android bounds format [left,top][right,bottom]', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];
    // Root: [0,0][1080,1920]
    expect(root.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    });

    // Email input: [20,200][1060,280]
    const emailInput = root.children[1];
    expect(emailInput.bounds).toEqual({
      x: 20,
      y: 200,
      width: 1040,
      height: 80,
    });
  });

  test('extracts resource-id as identifier', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];

    const emailInput = root.children[1];
    expect(emailInput.identifier).toBe('email_input');

    const loginBtn = root.children[3];
    expect(loginBtn.identifier).toBe('login_btn');
  });

  test('uses content-desc as label', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];

    const emailInput = root.children[1];
    expect(emailInput.label).toBe('Email');
  });

  test('parses text property', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];

    const loginBtn = root.children[3];
    expect(loginBtn.text).toBe('Sign In');
  });

  test('parses visible-to-user', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];

    const loginBtn = root.children[3];
    expect(loginBtn.isVisible).toBe(true);

    const forgotLink = root.children[4];
    expect(forgotLink.isVisible).toBe(false);
  });

  test('handles nested children', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const toolbar = nodes[0].children[0];
    expect(toolbar.type).toBe('Toolbar');
    expect(toolbar.label).toBe('Login');
    expect(toolbar.children).toHaveLength(1);
    expect(toolbar.children[0].type).toBe('TextView');
    expect(toolbar.children[0].text).toBe('Login');
  });

  test('handles empty hierarchy', () => {
    const nodes = parseAndroidHierarchy('<hierarchy rotation="0"/>');
    expect(nodes).toHaveLength(0);
  });

  test('preserves raw attributes', () => {
    const nodes = parseAndroidHierarchy(SAMPLE_ANDROID_XML);
    const root = nodes[0];
    expect(root.raw).toBeDefined();
    expect(root.raw!['package']).toBe('com.example.app');
  });
});
