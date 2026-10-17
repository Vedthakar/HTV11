"""Generate a small Xcode app project without extra project-generator dependencies."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'ios';p=root/'RoverCapture.xcodeproj';p.mkdir(exist_ok=True)
(p/'project.pbxproj').write_text('''// !$*UTF8*$!
{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
A00000000000000000000001 = {isa = PBXProject; attributes = {LastUpgradeCheck = 1600;}; buildConfigurationList = A00000000000000000000002; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en, Base); mainGroup = A00000000000000000000003; productRefGroup = A00000000000000000000004; projectDirPath = ""; projectRoot = ""; targets = (A00000000000000000000005);};
A00000000000000000000002 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000006,A00000000000000000000007); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
A00000000000000000000003 = {isa = PBXGroup; children = (A00000000000000000000008,A00000000000000000000004); sourceTree = "<group>";};
A00000000000000000000004 = {isa = PBXGroup; children = (A00000000000000000000009); name = Products; sourceTree = "<group>";};
A00000000000000000000005 = {isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000010; buildPhases = (A00000000000000000000011,A00000000000000000000012,A00000000000000000000013); buildRules = (); dependencies = (); name = RoverCapture; productName = RoverCapture; productReference = A00000000000000000000009; productType = "com.apple.product-type.application";};
A00000000000000000000006 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0;}; name = Debug;};
A00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0;}; name = Release;};
A00000000000000000000008 = {isa = PBXGroup; children = (A00000000000000000000014,A00000000000000000000015); path = RoverCapture; sourceTree = "<group>";};
A00000000000000000000009 = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = RoverCapture.app; sourceTree = BUILT_PRODUCTS_DIR;};
A00000000000000000000010 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000016,A00000000000000000000017); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
A00000000000000000000011 = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000018); runOnlyForDeploymentPostprocessing = 0;};
A00000000000000000000012 = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
A00000000000000000000013 = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;};
A00000000000000000000014 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RoverCaptureApp.swift; sourceTree = "<group>";};
A00000000000000000000015 = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";};
A00000000000000000000016 = {isa = XCBuildConfiguration; buildSettings = {CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_FILE = RoverCapture/Info.plist; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = com.htv.rovercapture; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; TARGETED_DEVICE_FAMILY = 1;}; name = Debug;};
A00000000000000000000017 = {isa = XCBuildConfiguration; buildSettings = {CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_FILE = RoverCapture/Info.plist; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = com.htv.rovercapture; PRODUCT_NAME = "$(TARGET_NAME)"; TARGETED_DEVICE_FAMILY = 1;}; name = Release;};
A00000000000000000000018 = {isa = PBXBuildFile; fileRef = A00000000000000000000014;};
}; rootObject = A00000000000000000000001; }
''')
print(p)
