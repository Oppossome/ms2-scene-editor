{ pkgs ? import <nixpkgs> { } }:

# Node for the app and the extraction scripts, plus the converters cmd/extract/*.sh shell out to
# (ffmpeg, vgmstream-cli for audio and video, ImageMagick for textures).
pkgs.mkShell {
  packages = with pkgs; [
    nodejs
    ffmpeg
    vgmstream
    imagemagick
  ];
}
