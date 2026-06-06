//go:build mage
// +build mage

package main

import (
	// mage:import
	"github.com/grafana/grafana-plugin-sdk-go/build"
	"github.com/magefile/mage/mg"
)

func init() {
	build.SetBeforeBuildCallback(func(cfg build.Config) (build.Config, error) {
		cfg.OutputBinaryPath = "plugins/victoriatraces-datasource"
		return cfg, nil
	})
}

func Build() {
	b := build.Build{}
	mg.Deps(b.Linux, b.Windows, b.Darwin, b.DarwinARM64, b.LinuxARM64, b.LinuxARM)
}

// Default configures the default target.
var Default = Build
