import { Component, createElement } from "react";
import AceEditor, { Marker, Mode } from "react-ace";
import { Operation, compare } from "fast-json-patch";
import jsonMap = require("json-source-map");

import { Accordion, AccordionProps } from "./Accordion";
import { MendixButton } from "./MendixButton";
import { Sidebar } from "./Sidebar";
import { TabContainer } from "./TabContainer";
import { TabHeader } from "./TabHeader";
import { TabPane } from "./TabPane";
import { TabTool } from "./TabTool";

import "brace";
import { ScatterTrace, SeriesData, SeriesProps } from "../utils/data";
import deepMerge from "deepmerge";
import { PieTraces } from "../PieChart/components/PieChart";
import { PieData } from "../../typings/plotly.js";
import { ScatterData } from "plotly.js";

import "brace/mode/json";
import "brace/mode/javascript";
import "brace/theme/github";

interface PlaygroundProps {
    supportSeries: boolean;
    layoutOptions: string;
    dataOptions?: string;
    modelerLayoutConfigs: string;
    modelerSeriesConfigs?: string[];
    rawData?: SeriesData[];
    chartData: ScatterData[] | PieData[];
    traces: PlaygroundSeriesTrace[] | PieTraces;
    onChange?: (layout: string, data: SeriesData[] | string) => void;
}

type PlaygroundSeriesTrace = ({ name: string } & ScatterTrace);

export class Playground extends Component<PlaygroundProps, { showEditor: boolean }> {
    private updatedOptions: { layout: string, data: SeriesData[] | string };
    private timeoutId: number;
    private isValid: boolean;

    constructor(props: PlaygroundProps) {
        super(props);

        this.updateChart = this.updateChart.bind(this);
        this.onValidate = this.onValidate.bind(this);
        this.toggleShowEditor = this.toggleShowEditor.bind(this);

        this.state = { showEditor: false };
        this.updatedOptions = {
            layout: props.layoutOptions || "{}",
            data: props.supportSeries ? props.rawData || [] : props.dataOptions || "{}"
        };
    }

    render() {
        return createElement("div", { className: "widget-charts-advanced" },
            createElement(Sidebar, { open: this.state.showEditor }, this.renderTabs()),
            createElement("div", { className: "widget-charts-advanced-toggle" },
                createElement(MendixButton, { onClick: this.toggleShowEditor }, "Toggle Playground")
            ),
            this.props.children
        );
    }

    private renderTabs() {
        if (!this.props.supportSeries && this.props.traces) {
            return createElement(TabContainer, { tabHeaderClass: "control-sidebar-tabs", justified: true },
                createElement(TabHeader, { title: "Layout" }),
                createElement(TabHeader, { title: "Data" }),
                createElement(TabHeader, { title: "Full" }),
                createElement(TabPane, {}, this.renderLayoutOptions()),
                createElement(TabPane, {}, this.renderData()),
                createElement(TabPane, {}, this.renderFullConfig()),
                this.renderSidebarCloser()
            );
        }

        return createElement(TabContainer, { tabHeaderClass: "control-sidebar-tabs", justified: true },
            createElement(TabHeader, { title: "Layout" }),
            createElement(TabPane, {}, this.renderLayoutOptions()),
            ...this.renderSeriesTabHeaders(),
            ...this.renderSeriesTabPanes(),
            createElement(TabHeader, { title: "Full" }),
            createElement(TabPane, {}, this.renderFullConfig()),
            this.renderSidebarCloser()
        );
    }

    private renderSidebarCloser() {
        return createElement(TabTool, { className: "pull-right remove", onClick: this.toggleShowEditor },
            createElement("em", { className: "glyphicon glyphicon-chevron-right" })
        );
    }

    private renderSeriesTabHeaders() {
        if (this.props.rawData) {
            return this.props.rawData.map(({ series }, index) =>
                createElement(TabHeader, { title: series.name, key: `series-header-${index}` })
            );
        }

        return [];
    }

    private renderSeriesTabPanes() {
        if (this.props.rawData) {
            return this.props.rawData.map(({ series }, index) =>
                createElement(TabPane, { key: `series-pane-${index}` },
                    this.renderSeriesOptions(series, index),
                    this.renderSeriesModelerConfig(index),
                    this.renderSeriesData(series, index)
                )
            );
        }

        return [];
    }

    private renderSeriesOptions(series: SeriesProps, index: number) {
        return createElement(Accordion,
            {
                title: "Advanced options",
                titleClass: "item-header",
                show: true
            },
            this.renderAceEditor(series.seriesOptions || "{\n\n}", value =>
                this.onUpdate(`series-${index}`, value)
            )
        );
    }

    private renderSeriesData(series: SeriesProps, index: number) {
        if (this.props.supportSeries && Array.isArray(this.props.traces)) {
            const seriesTrace = (this.props.traces as PlaygroundSeriesTrace[]).find(trace => trace.name === series.name);
            if (seriesTrace) {
                return createElement(Accordion, {
                        key: `series-${index}`,
                        title: "Data",
                        titleClass: "item-header",
                        show: false
                    },
                    this.renderAceEditor(JSON.stringify({ x: seriesTrace.x, y: seriesTrace.y }, null, 4), undefined, true)
                );
            }
        }

        return null;
    }

    private renderSeriesModelerConfig(index: number) {
        if (this.props.modelerSeriesConfigs && this.props.rawData) {
            return createElement(Accordion,
                {
                    title: "Modeler",
                    titleClass: "item-header",
                    show: true
                },
                this.renderAceEditor(
                    this.props.modelerSeriesConfigs[index] || "{\n\n}",
                    undefined,
                    true,
                    "json",
                    this.props.rawData[index].series.seriesOptions
                )
            );
        }

        return null;

    }

    private getStartAndEndPosOfDiff(textValue: string, diff: Operation) {
        const result = jsonMap.parse(textValue);
        const pointer = result.pointers[diff.path];
        if (pointer) {
            return {
                startRow: pointer.key.line,
                startCol: pointer.key.column,
                endRow: pointer.valueEnd.line,
                endCol: pointer.valueEnd.column
            };
        }
    }

    private getMarker(left: string, right?: string): Marker[] {
        const markers: Marker[] = [];
        if (right) {
            const diffs = compare(JSON.parse(left), JSON.parse(right));
            diffs.forEach(diff => {
                if (diff.op === "replace") {
                    const pos = this.getStartAndEndPosOfDiff(left, diff);
                    if (pos) {
                        markers.push({
                            startRow: pos.startRow,
                            startCol: pos.startCol,
                            endRow: pos.endRow,
                            endCol: pos.endCol,
                            type: "text",
                            className: "replaced-config"
                        });
                    }
                }
            });
        }
        return markers;
    }

    private renderAceEditor(value: string, onChange?: (value: string) => void, readOnly = false, mode: Mode = "json", overwriteValue?: string) {
        const markers = this.getMarker(value, overwriteValue);

        return createElement(AceEditor, {
            mode,
            value,
            readOnly,
            onChange,
            theme: "github",
            className: readOnly ? "ace-editor-read-only" : undefined,
            markers,
            maxLines: 1000, // crappy attempt to avoid a third scroll bar
            onValidate: this.onValidate,
            editorProps: { $blockScrolling: Infinity }
        });
    }

    private setAccordionProps(title: string, titleClass: string, show = true): AccordionProps {
        return { title, titleClass, show };
    }

    private renderLayoutOptions() {
        const layoutOptions = createElement(Accordion, {
            key: "layout",
            ...this.setAccordionProps("Advanced options", "item-header")
        }, this.renderAceEditor(this.props.layoutOptions, value => this.onUpdate("layout", value)));
        const modelerOptions = createElement(Accordion, {
            key: "modeler",
            ...this.setAccordionProps("Modeler", "item-header")
        }, this.renderAceEditor(this.props.modelerLayoutConfigs, undefined, true, "json", this.props.layoutOptions));
        if (!this.props.supportSeries && this.props.dataOptions) {
            const dataOptions = createElement(Accordion, {
                key: "data",
                ...this.setAccordionProps("Data options", "item-header")
            }, this.renderAceEditor(this.props.dataOptions, value => this.onUpdate("data", value)));

            return [ layoutOptions, modelerOptions, dataOptions ];
        }

        return [ layoutOptions, modelerOptions ];
    }

    private renderData() {
        if (!this.props.supportSeries && this.props.traces) {
            return createElement("div", {},
                this.renderAceEditor(JSON.stringify(this.props.traces as PieTraces, null, 4), undefined, true)
            );
        }

        return null;
    }

    private renderFullConfig() {
        const mergedLayoutOptions = deepMerge.all([
            JSON.parse(this.props.modelerLayoutConfigs),
            JSON.parse(this.props.layoutOptions)
        ]);
        let value = `var layoutOptions = ${JSON.stringify(mergedLayoutOptions, null, 4)};\n\n`;
        if (this.props.supportSeries) {
            value = value + (this.props.chartData as ScatterData[]).map(Playground.getSeriesCode).join("\n\n");
        } else if (!this.props.supportSeries) {
            const mergedDataOptions = deepMerge.all([
                JSON.parse(this.props.dataOptions || "{}"),
                (this.props.chartData as PieData[])[0]
            ]);
            value = value + `var data = [${JSON.stringify(mergedDataOptions, null, 4)}]`;
        }

        return createElement(AceEditor, {
            mode: "javascript",
            readOnly: true,
            value,
            theme: "github",
            maxLines: 1000, // crappy attempt to avoid a third scroll bar
            className: "ace-editor-read-only",
            editorProps: { $blockScrolling: Infinity }
        });
    }

    private toggleShowEditor() {
        this.setState({ showEditor: !this.state.showEditor });
    }

    private onUpdate(source: string, value: string) {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        this.timeoutId = setTimeout(() => {
            if (this.isValid) {
                this.updateChart(source, value);
            }
        }, 1000);
    }

    private onValidate(annotations: object[]) {
        this.isValid = !annotations.length;
    }

    private updateChart(source: string, value: string) {
        if (source === "layout") {
            this.updatedOptions.layout = value;
        }
        if (source.indexOf("series") > -1) {
            const index = source.split("-")[ 1 ];
            (this.updatedOptions.data[ parseInt(index, 10) ] as SeriesData).series.seriesOptions = value;
        } else if (source.indexOf("data") > -1) {
            this.updatedOptions.data = value;
        }
        if (this.props.onChange) {
            this.props.onChange(this.updatedOptions.layout, this.updatedOptions.data);
        }
    }

    private static getSeriesCode(series: ScatterData, index: number) {
        return `var series${index} = ${JSON.stringify(Playground.cleanSeries(series), null, 4)};`;
    }

    private static cleanSeries(series: ScatterData): Partial<ScatterData> {
        return { ...series, customdata: undefined, series: undefined };
    }
}
