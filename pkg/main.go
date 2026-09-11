package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"

	"github.com/dmitryk-dk/victoriatraces-datasource/pkg/plugin"
)

func main() {
	if err := datasource.Manage(
		"victoriametrics-traces-datasource",
		plugin.NewDatasource,
		datasource.ManageOpts{},
	); err != nil {
		backend.Logger.Error(err.Error())
		os.Exit(1)
	}
}
