/**
 * send_to_copilot - the direct pipe into Visual Studio's GitHub Copilot Chat.
 *
 * Uses Windows UI Automation (not blind keystrokes): finds the Visual Studio
 * window (launching it if needed), selects the "GitHub Copilot Chat" tab,
 * focuses the "Ask Copilot" input, pastes the text and presses Send. Agent
 * mode in that chat then follows the order with all Cedar Tree tools.
 */
import { z } from "zod";
import { spawn } from "node:child_process";
import type { ToolRegistry } from "../registry.js";
import { jsonResult, textResult } from "../registry.js";
import { findVisualStudio } from "./open-target.js";

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;using System.Runtime.InteropServices;
public class CtWin{
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
function Out-Result($ok, $msg) { [Console]::Out.WriteLine((@{ ok = $ok; message = $msg } | ConvertTo-Json -Compress)); exit 0 }
function Find-ByName($root, $type, $like) {
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)
  foreach ($e in $root.FindAll($TS::Descendants, $c)) { if ($e.Current.Name -like $like) { return $e } }
  return $null
}
try {
  $text = $env:CT_TEXT
  $submit = $env:CT_SUBMIT -eq '1'
  $vs = $env:CT_VS
  $deadline = (Get-Date).AddSeconds(90)
  $p = $null
  while ((Get-Date) -lt $deadline) {
    $p = Get-Process devenv -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($p) { break }
    if (-not (Get-Process devenv -ErrorAction SilentlyContinue) -and $vs) { Start-Process $vs | Out-Null; $vs = $null }
    Start-Sleep -Milliseconds 800
  }
  if (-not $p) { Out-Result $false 'Visual Studio window was not found.' }

  [CtWin]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [CtWin]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
  [CtWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [CtWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 500
  $root = $AE::FromHandle($p.MainWindowHandle)

  $edit = $null
  for ($i = 0; $i -lt 40 -and -not $edit; $i++) {
    $tab = Find-ByName $root ([System.Windows.Automation.ControlType]::TabItem) 'GitHub Copilot Chat*'
    if ($tab) { try { $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch {} }
    $edit = Find-ByName $root ([System.Windows.Automation.ControlType]::Edit) 'Ask Copilot*'
    if (-not $edit -and $i -eq 6) { [System.Windows.Forms.SendKeys]::SendWait('^\'); [System.Windows.Forms.SendKeys]::SendWait('^c') }
    if (-not $edit) { Start-Sleep -Milliseconds 700 }
  }
  if (-not $edit) { Out-Result $false 'Could not find the Copilot Chat input. Open Copilot Chat once (View > GitHub Copilot Chat) and sign in.' }

  $focused = $null
  for ($i = 0; $i -lt 4; $i++) {
    $edit = Find-ByName $root ([System.Windows.Automation.ControlType]::Edit) 'Ask Copilot*'
    if (-not $edit) { Start-Sleep -Milliseconds 500; continue }
    try { $edit.SetFocus() } catch {
      $r = $edit.Current.BoundingRectangle
      if (-not $r.IsEmpty) {
        [CtWin]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
        [CtWin]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [CtWin]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      }
    }
    Start-Sleep -Milliseconds 500
    $focused = $AE::FocusedElement
    if ($focused.Current.Name -like 'Ask Copilot*') { break }
  }
  if (-not $focused -or $focused.Current.Name -notlike 'Ask Copilot*') { Out-Result $false 'Could not focus the Copilot Chat input, so nothing was typed.' }

  $previous = $null
  try { $previous = [System.Windows.Forms.Clipboard]::GetText() } catch {}
  [System.Windows.Forms.Clipboard]::SetText($text)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 600
  if ($previous) { try { [System.Windows.Forms.Clipboard]::SetText($previous) } catch {} }

  if ($submit) {
    $send = $null
    for ($i = 0; $i -lt 10 -and -not $send; $i++) {
      $send = Find-ByName $root ([System.Windows.Automation.ControlType]::Button) 'Send*'
      if (-not $send) { Start-Sleep -Milliseconds 300 }
    }
    if ($send) { $send.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    else { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
    Out-Result $true 'Sent to Visual Studio Copilot Chat.'
  }
  Out-Result $true 'Pasted into Visual Studio Copilot Chat (not sent).'
} catch {
  Out-Result $false ('UI automation failed: ' + $_.Exception.Message)
}
`;

export interface CopilotSendResult {
  ok: boolean;
  message: string;
}

export function sendToCopilot(text: string, submit = true): Promise<CopilotSendResult> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, message: "send_to_copilot is only supported on Windows." });
      return;
    }
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        env: {
          ...process.env,
          CT_TEXT: text,
          CT_SUBMIT: submit ? "1" : "0",
          CT_VS: findVisualStudio() ?? "",
        },
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, message: err.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
      try {
        resolve(JSON.parse(line ?? ""));
      } catch {
        resolve({ ok: false, message: "No response from the Visual Studio automation script." });
      }
    });
  });
}

export function register(registry: ToolRegistry): void {
  registry.registerTool({
    name: "send_to_copilot",
    description:
      "Send a text order to GitHub Copilot Chat inside Visual Studio 2026 (launches Visual Studio if needed). Copilot agent mode there then carries out the order. Use for coding requests such as 'fix this bug' or 'add a login page'.",
    inputSchema: {
      text: z.string().min(1).describe("The order/prompt to send to Copilot Chat in Visual Studio."),
      submit: z.boolean().optional().describe("Press Send after pasting. Defaults to true."),
    },
    handler: async ({ text, submit }: { text: string; submit?: boolean }) => {
      const result = await sendToCopilot(text, submit ?? true);
      return result.ok ? jsonResult(result) : textResult(`send_to_copilot failed: ${result.message}`, true);
    },
  });
}
