import { test, expect } from '@playwright/test';
import { parseIosHierarchy } from './ios-hierarchy-parser.js';

const SAMPLE_IOS_XML = `
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="TestApp" label="TestApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" x="0" y="0" width="390" height="844">
        <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Login" label="Login" enabled="true" visible="true" x="0" y="47" width="390" height="44">
          <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Login" label="Login" enabled="true" visible="true" x="164" y="53" width="62" height="32"/>
        </XCUIElementTypeNavigationBar>
        <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="emailField" label="Email" value="" enabled="true" visible="true" x="20" y="120" width="350" height="44" placeholderValue="Enter email"/>
        <XCUIElementTypeSecureTextField type="XCUIElementTypeSecureTextField" name="passwordField" label="Password" value="" enabled="true" visible="true" x="20" y="180" width="350" height="44" placeholderValue="Enter password"/>
        <XCUIElementTypeButton type="XCUIElementTypeButton" name="loginButton" label="Sign In" enabled="true" visible="true" x="20" y="250" width="350" height="50"/>
        <XCUIElementTypeButton type="XCUIElementTypeButton" name="forgotPassword" label="Forgot Password?" enabled="true" visible="false" x="20" y="320" width="350" height="30"/>
        <XCUIElementTypeSwitch type="XCUIElementTypeSwitch" name="rememberMe" label="Remember Me" value="0" enabled="true" visible="true" selected="false" x="20" y="370" width="51" height="31"/>
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

test.describe('parseIosHierarchy', () => {
  test('parses root element correctly', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('Application');
    expect(nodes[0].identifier).toBe('TestApp');
    expect(nodes[0].label).toBe('TestApp');
  });

  test('builds correct tree structure', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const app = nodes[0];
    expect(app.children).toHaveLength(1); // Window

    const window = app.children[0];
    expect(window.type).toBe('Window');
    expect(window.children).toHaveLength(1); // Other

    const other = window.children[0];
    expect(other.children).toHaveLength(6); // NavBar + TextField + SecureTextField + 2 Buttons + Switch
  });

  test('strips XCUIElementType prefix from type names', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const types = other.children.map((c) => c.type);
    expect(types).toEqual([
      'NavigationBar',
      'TextField',
      'SecureTextField',
      'Button',
      'Button',
      'Switch',
    ]);
  });

  test('parses bounds correctly', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const emailField = other.children[1]; // TextField
    expect(emailField.bounds).toEqual({
      x: 20,
      y: 120,
      width: 350,
      height: 44,
    });
  });

  test('parses visibility and enabled state', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const loginButton = other.children[3]; // Sign In button
    expect(loginButton.isVisible).toBe(true);
    expect(loginButton.isEnabled).toBe(true);

    const forgotPassword = other.children[4]; // Hidden button
    expect(forgotPassword.isVisible).toBe(false);
  });

  test('parses accessibility identifiers and labels', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const emailField = other.children[1];
    expect(emailField.identifier).toBe('emailField');
    expect(emailField.label).toBe('Email');
    expect(emailField.placeholder).toBe('Enter email');
  });

  test('parses value and selected state', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const toggle = other.children[5]; // Switch
    expect(toggle.value).toBe('0');
    expect(toggle.label).toBe('Remember Me');
  });

  test('preserves raw attributes', () => {
    const nodes = parseIosHierarchy(SAMPLE_IOS_XML);
    const other = nodes[0].children[0].children[0];
    const emailField = other.children[1];
    expect(emailField.raw).toBeDefined();
    expect(emailField.raw!['placeholderValue']).toBe('Enter email');
  });

  test('handles empty XML', () => {
    const nodes = parseIosHierarchy('');
    expect(nodes).toHaveLength(0);
  });

  test('handles self-closing AppiumAUT', () => {
    const nodes = parseIosHierarchy('<AppiumAUT/>');
    expect(nodes).toHaveLength(0);
  });
});
