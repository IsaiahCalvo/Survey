
import os

icons_path = '/Users/isaiahcalvo/Desktop/Survey/src/Icons.jsx'
b64_path = '/Users/isaiahcalvo/Desktop/Survey/temp_highlighter_b64.txt'

if not os.path.exists(icons_path):
    print(f"Error: {icons_path} not found")
    exit(1)

if not os.path.exists(b64_path):
    print(f"Error: {b64_path} not found")
    exit(1)

with open(b64_path, 'r') as f:
    b64_content = f.read().strip()

data_uri = f'data:image/png;base64,{b64_content}'

with open(icons_path, 'r') as f:
    content = f.read()

# Target strings to replace
target_mask = "maskImage: 'url(\"/highlighter-icon.png\")'"
target_webkit = "WebkitMaskImage: 'url(\"/highlighter-icon.png\")'"

replacement_mask = f"maskImage: 'url(\"{data_uri}\")'"
replacement_webkit = f"WebkitMaskImage: 'url(\"{data_uri}\")'"

new_content = content.replace(target_mask, replacement_mask)
new_content = new_content.replace(target_webkit, replacement_webkit)

if content == new_content:
    print("Warning: No changes made. Targets might not match.")
else:
    with open(icons_path, 'w') as f:
        f.write(new_content)
    print("Successfully updated Icons.jsx with base64 icon.")
