
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace A50Audio
{
    public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr ppFormat);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr pDefaultPeriod, IntPtr pMinimumPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pPeriod);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr pKey, IntPtr pValue);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr pKey, IntPtr pValue);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ERole role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    public class PolicyConfigClient { }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumerator { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        [PreserveSig] int OpenPropertyStore(int stgmRead, out IntPtr ppProperties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        [PreserveSig] int GetState(out int pdwState);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint pcDevices);
        [PreserveSig] int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT
    {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
    }

    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint cProps);
        [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        [PreserveSig] int Commit();
    }

    public class Program
    {
        const int eRender = 0;
        const int DEVICE_STATE_ACTIVE = 0x1;
        const int STGM_READ = 0;

        static IMMDeviceEnumerator CreateEnumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumerator();
        }

        static string GetName(IMMDevice dev)
        {
            IntPtr storePtr;
            int hr = dev.OpenPropertyStore(STGM_READ, out storePtr);
            if (hr != 0) return "";
            IPropertyStore store = (IPropertyStore)Marshal.GetObjectForIUnknown(storePtr);
            Marshal.Release(storePtr);
            PROPERTYKEY key = new PROPERTYKEY();
            key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
            key.pid = 14;
            PROPVARIANT pv;
            hr = store.GetValue(ref key, out pv);
            if (hr != 0 || (pv.vt != 31 && pv.vt != 30)) return "";
            string name = Marshal.PtrToStringUni(pv.p) ?? "";
            if (pv.p != IntPtr.Zero) Marshal.FreeCoTaskMem(pv.p);
            Marshal.ReleaseComObject(store);
            return name;
        }

        static string GetDefaultId(int role)
        {
            IMMDeviceEnumerator en = CreateEnumerator();
            IMMDevice dev;
            int hr = en.GetDefaultAudioEndpoint(eRender, role, out dev);
            if (hr != 0) return "";
            string id;
            dev.GetId(out id);
            Marshal.ReleaseComObject(dev);
            Marshal.ReleaseComObject(en);
            return id;
        }

        static int List()
        {
            IMMDeviceEnumerator en = CreateEnumerator();
            IntPtr colPtr;
            int hr = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out colPtr);
            if (hr != 0) { Console.Error.WriteLine("EnumAudioEndpoints failed 0x" + hr.ToString("X")); return 1; }
            IMMDeviceCollection col = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(colPtr);
            Marshal.Release(colPtr);
            uint count;
            col.GetCount(out count);
            string defaultId = GetDefaultId((int)ERole.eMultimedia);
            for (uint i = 0; i < count; i++)
            {
                IMMDevice dev;
                col.Item(i, out dev);
                string id;
                dev.GetId(out id);
                string name = GetName(dev);
                string def = (id == defaultId) ? "1" : "0";
                Console.WriteLine(def + "\t" + id + "\t" + name);
                Marshal.ReleaseComObject(dev);
            }
            Marshal.ReleaseComObject(col);
            Marshal.ReleaseComObject(en);
            return 0;
        }

        static int SetDefault(string id)
        {
            IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient();
            int worst = 0;
            foreach (ERole role in new ERole[] { ERole.eConsole, ERole.eMultimedia, ERole.eCommunications })
            {
                int hr = pc.SetDefaultEndpoint(id, role);
                if (hr != 0) worst = hr;
            }
            Marshal.ReleaseComObject(pc);
            if (worst != 0) { Console.Error.WriteLine("SetDefaultEndpoint failed 0x" + worst.ToString("X")); return 1; }
            Console.WriteLine("OK");
            return 0;
        }

        public static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "list") return List();
            if (args.Length == 2 && args[0] == "set") return SetDefault(args[1]);
            if (args.Length == 1 && args[0] == "getdefault") { Console.WriteLine(GetDefaultId((int)ERole.eMultimedia)); return 0; }
            Console.Error.WriteLine("usage: list | set <id> | getdefault");
            return 2;
        }
    }
}
